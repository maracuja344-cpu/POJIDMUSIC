import type { TelegramIdentity } from "./telegram.ts";

export type Mapping = TelegramIdentity & { userId: string };
export type AuthUser = { id: string; email?: string | null };
export type ProfileState = { role: string; artistCount: number };

export interface TelegramAuthBackend {
  findByTelegramId(id: number): Promise<Mapping | null>;
  findByUserId(id: string): Promise<Mapping | null>;
  insertMapping(mapping: Mapping): Promise<"inserted" | "conflict">;
  reassignMapping(identity: TelegramIdentity, userId: string): Promise<"reassigned" | "conflict">;
  updateTelegramProfile(identity: TelegramIdentity): Promise<void>;
  syncProfile(identity: TelegramIdentity, userId: string): Promise<void>;
  getAuthUser(id: string): Promise<AuthUser | null>;
  verifyAccessToken(token: string): Promise<AuthUser | null>;
  createAuthUser(email: string, displayName: string | null): Promise<{ user: AuthUser | null; errorCode?: string }>;
  deleteAuthUser(id: string): Promise<void>;
  inspectProfile(id: string): Promise<ProfileState | null>;
  generateMagicLink(email: string): Promise<string | null>;
}

export class LinkConflictError extends Error {}
export class UnauthorizedError extends Error {}
export class InternalAuthError extends Error {}

const internalEmail = (telegramId: number) => `telegram-${telegramId}@auth.pojidmusic.invalid`;

async function sessionPayload(backend: TelegramAuthBackend, user: AuthUser) {
  if (!user.email) throw new InternalAuthError("Linked user has no usable email");
  const tokenHash = await backend.generateMagicLink(user.email);
  if (!tokenHash) throw new InternalAuthError("Could not generate session token");
  return { status: "linked", token_hash: tokenHash, otp_type: "email" } as const;
}

export class TelegramAuthService {
  constructor(private readonly backend: TelegramAuthBackend) {}

  async bootstrap(identity: TelegramIdentity) {
    const mapping = await this.backend.findByTelegramId(identity.id);
    if (!mapping) return { status: "unlinked" } as const;
    const user = await this.backend.getAuthUser(mapping.userId);
    if (!user) throw new InternalAuthError("Linked user is missing");
    await this.backend.updateTelegramProfile(identity);
    await this.backend.syncProfile(identity, user.id);
    return sessionPayload(this.backend, user);
  }

  async link(identity: TelegramIdentity, accessToken: string | null) {
    if (!accessToken) throw new UnauthorizedError();
    const user = await this.backend.verifyAccessToken(accessToken);
    if (!user) throw new UnauthorizedError();

    const byTelegram = await this.backend.findByTelegramId(identity.id);
    const byUser = await this.backend.findByUserId(user.id);
    if (byTelegram?.userId === user.id && byUser?.id === identity.id) {
      await this.backend.updateTelegramProfile(identity);
      await this.backend.syncProfile(identity, user.id);
      return { status: "linked" } as const;
    }
    if (byTelegram || byUser) throw new LinkConflictError();

    if (await this.backend.insertMapping({ ...identity, userId: user.id }) === "conflict") {
      throw new LinkConflictError();
    }
    await this.backend.syncProfile(identity, user.id);
    return { status: "linked" } as const;
  }

  async relink(identity: TelegramIdentity, accessToken: string | null) {
    if (!accessToken) throw new UnauthorizedError();
    const target = await this.backend.verifyAccessToken(accessToken);
    if (!target) throw new UnauthorizedError();

    const byTelegram = await this.backend.findByTelegramId(identity.id);
    const byTargetUser = await this.backend.findByUserId(target.id);
    if (byTargetUser && byTargetUser.id !== identity.id) throw new LinkConflictError();
    if (!byTelegram) return this.link(identity, accessToken);

    if (byTelegram.userId === target.id) {
      await this.backend.updateTelegramProfile(identity);
      await this.backend.syncProfile(identity, target.id);
      return { status: "linked" } as const;
    }

    const source = await this.backend.getAuthUser(byTelegram.userId);
    const profile = await this.backend.inspectProfile(byTelegram.userId);
    if (!(source?.email === internalEmail(identity.id) && profile?.role === "listener" && profile.artistCount === 0)) {
      throw new LinkConflictError();
    }

    if (await this.backend.reassignMapping(identity, target.id) === "conflict") {
      throw new LinkConflictError();
    }
    await this.backend.syncProfile(identity, target.id);
    return { status: "linked" } as const;
  }

  async register(identity: TelegramIdentity) {
    const existing = await this.backend.findByTelegramId(identity.id);
    if (existing) {
      const user = await this.backend.getAuthUser(existing.userId);
      if (!user) throw new InternalAuthError();
      await this.backend.syncProfile(identity, user.id);
      return sessionPayload(this.backend, user);
    }

    const created = await this.backend.createAuthUser(internalEmail(identity.id), identity.displayName);
    if (!created.user) {
      if (created.errorCode === "email_exists") throw new LinkConflictError();
      throw new InternalAuthError();
    }

    try {
      const profile = await this.backend.inspectProfile(created.user.id);
      if (!profile || profile.role !== "listener" || profile.artistCount !== 0) {
        throw new InternalAuthError();
      }
      if (await this.backend.insertMapping({ ...identity, userId: created.user.id }) === "conflict") {
        throw new LinkConflictError();
      }
      await this.backend.syncProfile(identity, created.user.id);
      return await sessionPayload(this.backend, created.user);
    } catch (error) {
      await this.backend.deleteAuthUser(created.user.id).catch(() => undefined);
      throw error;
    }
  }
}
