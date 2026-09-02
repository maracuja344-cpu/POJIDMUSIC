import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  LinkConflictError,
  TelegramAuthService,
  UnauthorizedError,
  type AuthUser,
  type Mapping,
  type ProfileState,
  type TelegramAuthBackend,
} from "../supabase/functions/telegram-auth/service.ts";
import { TelegramAuthError, verifyTelegramInitData } from "../supabase/functions/telegram-auth/telegram.ts";

const NOW = 1_725_000_000;
const BOT_TOKEN = "123456789:independent-test-token-not-a-secret";
const identity = { id: 42424242, username: "test_listener", displayName: "Test Listener" };

function independentInitData(overrides: Record<string, string> = {}) {
  const fields = {
    auth_date: String(NOW),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: identity.id, first_name: "Test", last_name: "Listener", username: identity.username, language_code: "en" }),
    ...overrides,
  };
  const check = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  // Independent Node implementation of Telegram's two-stage HMAC test vector.
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

class FakeBackend implements TelegramAuthBackend {
  mappings: Mapping[] = [];
  users = new Map<string, AuthUser>();
  profiles = new Map<string, ProfileState>();
  validTokens = new Map<string, AuthUser>();
  generated: string[] = [];
  deleted: string[] = [];
  nextCreateError?: string;
  insertConflict = false;
  createCount = 0;
  createdEmails = new Set<string>();

  async findByTelegramId(id: number) { return this.mappings.find((mapping) => mapping.id === id) ?? null; }
  async findByUserId(id: string) { return this.mappings.find((mapping) => mapping.userId === id) ?? null; }
  async insertMapping(mapping: Mapping) {
    if (this.insertConflict || this.mappings.some((item) => item.id === mapping.id || item.userId === mapping.userId)) return "conflict" as const;
    this.mappings.push(mapping);
    return "inserted" as const;
  }
  async updateTelegramProfile(value: typeof identity) {
    const mapping = await this.findByTelegramId(value.id);
    if (mapping) Object.assign(mapping, value);
  }
  async getAuthUser(id: string) { return this.users.get(id) ?? null; }
  async verifyAccessToken(token: string) { return this.validTokens.get(token) ?? null; }
  async createAuthUser(email: string, displayName: string | null) {
    this.createCount += 1;
    if (this.nextCreateError) return { user: null, errorCode: this.nextCreateError };
    if (this.createdEmails.has(email)) return { user: null, errorCode: "email_exists" };
    this.createdEmails.add(email);
    const user = { id: `new-user-${this.createCount}`, email };
    this.users.set(user.id, user);
    this.profiles.set(user.id, { role: "listener", artistCount: 0 });
    assert.equal(displayName, identity.displayName);
    return { user };
  }
  async deleteAuthUser(id: string) { this.deleted.push(id); this.users.delete(id); }
  async inspectProfile(id: string) { return this.profiles.get(id) ?? null; }
  async generateMagicLink(email: string) { this.generated.push(email); return `hash-for-${email}`; }
}

test("accepts independently calculated valid Telegram initData", async () => {
  assert.deepEqual(await verifyTelegramInitData(independentInitData(), BOT_TOKEN, NOW), identity);
});

test("rejects initData after one character changes", async () => {
  const valid = independentInitData();
  await assert.rejects(() => verifyTelegramInitData(valid.replace("Listener", "Listemer"), BOT_TOKEN, NOW), TelegramAuthError);
});

test("rejects an incorrect hash", async () => {
  const params = new URLSearchParams(independentInitData());
  params.set("hash", "0".repeat(64));
  await assert.rejects(() => verifyTelegramInitData(params.toString(), BOT_TOKEN, NOW), TelegramAuthError);
});

for (const field of ["hash", "auth_date", "user"]) {
  test(`rejects missing ${field}`, async () => {
    const params = new URLSearchParams(independentInitData()); params.delete(field);
    await assert.rejects(() => verifyTelegramInitData(params.toString(), BOT_TOKEN, NOW), TelegramAuthError);
  });
}

test("rejects expired auth_date", async () => {
  await assert.rejects(() => verifyTelegramInitData(independentInitData({ auth_date: String(NOW - 301) }), BOT_TOKEN, NOW), TelegramAuthError);
});

test("rejects auth_date beyond future skew", async () => {
  await assert.rejects(() => verifyTelegramInitData(independentInitData({ auth_date: String(NOW + 31) }), BOT_TOKEN, NOW), TelegramAuthError);
});

test("rejects malformed user JSON", async () => {
  await assert.rejects(() => verifyTelegramInitData(independentInitData({ user: "{" }), BOT_TOKEN, NOW), TelegramAuthError);
});

test("accepts a Telegram user without username", async () => {
  const raw = independentInitData({ user: JSON.stringify({ id: identity.id, first_name: "Listener" }) });
  assert.deepEqual(await verifyTelegramInitData(raw, BOT_TOKEN, NOW), { id: identity.id, username: null, displayName: "Listener" });
});

test("bootstrap returns unlinked without creating a user", async () => {
  const backend = new FakeBackend();
  assert.deepEqual(await new TelegramAuthService(backend).bootstrap(identity), { status: "unlinked" });
  assert.equal(backend.createCount, 0);
});

test("bootstrap returns only the OTP exchange fields for a mapping", async () => {
  const backend = new FakeBackend();
  backend.mappings.push({ ...identity, userId: "user-1" });
  backend.users.set("user-1", { id: "user-1", email: "existing@example.test" });
  assert.deepEqual(await new TelegramAuthService(backend).bootstrap(identity), {
    status: "linked", token_hash: "hash-for-existing@example.test", otp_type: "email",
  });
});

test("link rejects a missing Supabase JWT", async () => {
  await assert.rejects(() => new TelegramAuthService(new FakeBackend()).link(identity, null), UnauthorizedError);
});

test("link rejects an invalid Supabase JWT", async () => {
  await assert.rejects(() => new TelegramAuthService(new FakeBackend()).link(identity, "invalid"), UnauthorizedError);
});

test("link succeeds using the user from the verified JWT", async () => {
  const backend = new FakeBackend(); backend.validTokens.set("valid", { id: "user-1", email: "u@example.test" });
  assert.deepEqual(await new TelegramAuthService(backend).link(identity, "valid"), { status: "linked" });
  assert.equal(backend.mappings[0].userId, "user-1");
});

test("identical link is idempotent", async () => {
  const backend = new FakeBackend(); backend.validTokens.set("valid", { id: "user-1" });
  backend.mappings.push({ ...identity, userId: "user-1" });
  assert.deepEqual(await new TelegramAuthService(backend).link(identity, "valid"), { status: "linked" });
  assert.equal(backend.mappings.length, 1);
});

test("link rejects a Telegram ID conflict", async () => {
  const backend = new FakeBackend(); backend.validTokens.set("valid", { id: "user-2" });
  backend.mappings.push({ ...identity, userId: "user-1" });
  await assert.rejects(() => new TelegramAuthService(backend).link(identity, "valid"), LinkConflictError);
});

test("link rejects a Supabase user ID conflict", async () => {
  const backend = new FakeBackend(); backend.validTokens.set("valid", { id: "user-1" });
  backend.mappings.push({ ...identity, id: 999, userId: "user-1" });
  await assert.rejects(() => new TelegramAuthService(backend).link(identity, "valid"), LinkConflictError);
});

test("register creates a listener and mapping and returns an OTP token hash", async () => {
  const backend = new FakeBackend();
  const result = await new TelegramAuthService(backend).register(identity);
  assert.equal(result.otp_type, "email");
  assert.match(result.token_hash, /telegram-42424242@auth\.pojidmusic\.invalid/);
  assert.equal(backend.mappings.length, 1);
});

test("repeat register is idempotent", async () => {
  const backend = new FakeBackend(); const service = new TelegramAuthService(backend);
  await service.register(identity); await service.register(identity);
  assert.equal(backend.createCount, 1);
  assert.equal(backend.mappings.length, 1);
});

test("concurrent register does not create a second mapping", async () => {
  const backend = new FakeBackend(); const service = new TelegramAuthService(backend);
  const results = await Promise.all([service.register(identity), service.register(identity)]);
  assert.equal(results.length, 2);
  assert.equal(backend.mappings.length, 1);
});

test("new registration requires a listener profile", async () => {
  const backend = new FakeBackend();
  backend.inspectProfile = async () => ({ role: "artist", artistCount: 1 });
  await assert.rejects(() => new TelegramAuthService(backend).register(identity));
  assert.deepEqual(backend.deleted, ["new-user-1"]);
});

test("new registration requires no Artist entity", async () => {
  const backend = new FakeBackend();
  backend.inspectProfile = async () => ({ role: "listener", artistCount: 1 });
  await assert.rejects(() => new TelegramAuthService(backend).register(identity));
});

test("responses and logging code do not expose server secrets or sessions", async () => {
  const index = await readFile(new URL("../supabase/functions/telegram-auth/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(index, /access_token|refresh_token|action_link|rawInitData|console\.log/);
  const backend = new FakeBackend(); backend.mappings.push({ ...identity, userId: "u" }); backend.users.set("u", { id: "u", email: "u@example.test" });
  assert.deepEqual(Object.keys(await new TelegramAuthService(backend).bootstrap(identity)).sort(), ["otp_type", "status", "token_hash"]);
});
