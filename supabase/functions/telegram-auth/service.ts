import type { TelegramIdentity } from "./telegram.ts";

export type Mapping = TelegramIdentity & { userId: string };
export type AuthUser = { id: string; email?: string | null };
export type ProfileState = { role: string; artistCount: number };

export interface TelegramAuthBackend {
  findByTelegramId(id: number): Promise<Mapping | null>;
  findByUserId(id: string): Promise<Mapping | null>;
  insertMapping(mapping: Mapping): Promise<"inserted" | "conflict">;
  updateTelegramProfile(identity: TelegramIdentity): Promise<void>;
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
  private readonly backend: TelegramAuthBackend;

  constructor(backend: TelegramAuthBackend) {
    this.backend = backend;
  }

  async bootstrap(identity: TelegramIdentity) {
    const mapping = await this.backend.findByTelegramId(identity.id);
    if (!mapping) return { status: "unlinked" } as const;
    const user = await this.backend.getAuthUser(mapping.userId);
    if (!user) throw new InternalAuthError("Linked user is missing");
    await this.backend.updateTelegramProfile(identity);
    return sessionPayload(this.backend, user);
  }

  async link(identity: TelegramIdentity, accessToken: string | null) {
    if (!accessToken) throw new UnauthorizedError("A valid Supabase access token is required");
    const user = await this.backend.verifyAccessToken(accessToken);
    if (!user) throw new UnauthorizedError("A valid Supabase access token is required");

    const byTelegram = await this.backend.findByTelegramId(identity.id);
    const byUser = await this.backend.findByUserId(user.id);
    if (byTelegram?.userId === user.id && byUser?.id === identity.id) {
      await this.backend.updateTelegramProfile(identity);
      return { status: "linked" } as const;
    }
    if (byTelegram || byUser) throw new LinkConflictError("Account link already belongs to another user");

    const inserted = await this.backend.insertMapping({ ...identity, userId: user.id });
    if (inserted === "conflict") {
      const winner = await this.backend.findByTelegramId(identity.id);
      if (winner?.userId === user.id) return { status: "linked" } as const;
      throw new LinkConflictError("Account link already belongs to another user");
    }
    return { status: "linked" } as const;
  }

  async register(identity: TelegramIdentity) {
    const existing = await this.backend.findByTelegramId(identity.id);
    if (existing) {
      const user = await this.backend.getAuthUser(existing.userId);
      if (!user) throw new InternalAuthError("Linked user is missing");
      return sessionPayload(this.backend, user);
    }

    const email = internalEmail(identity.id);
    const created = await this.backend.createAuthUser(email, identity.displayName);
    if (!created.user) {
      if (created.errorCode === "email_exists") {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const winner = await this.backend.findByTelegramId(identity.id);
          if (winner) {
            const user = await this.backend.getAuthUser(winner.userId);
            if (user) return sessionPayload(this.backend, user);
          }
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        }
        throw new LinkConflictError("Registration is already in progress; retry safely");
      }
      throw new InternalAuthError("Could not create user");
    }

    const createdUser = created.user;
    try {
      const profile = await this.backend.inspectProfile(createdUser.id);
      if (!profile || profile.role !== "listener" || profile.artistCount !== 0) {
        throw new InternalAuthError("New user invariant failed");
      }
      const inserted = await this.backend.insertMapping({ ...identity, userId: createdUser.id });
      if (inserted === "conflict") {
        const winner = await this.backend.findByTelegramId(identity.id);
        if (winner?.userId !== createdUser.id) throw new LinkConflictError("Registration conflict");
      }
      return await sessionPayload(this.backend, createdUser);
    } catch (error) {
      await this.backend.deleteAuthUser(createdUser.id).catch(() => undefined);
      throw error;
    }
  }
}
