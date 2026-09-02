import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import {
  InternalAuthError,
  LinkConflictError,
  TelegramAuthService,
  UnauthorizedError,
  type Mapping,
  type TelegramAuthBackend,
} from "./service.ts";
import { TelegramAuthError, verifyTelegramInitData } from "./telegram.ts";

const MAX_BODY_BYTES = 12_288;
const allowedOrigins = new Set([
  "https://maracuja344-cpu.github.io",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

const corsHeaders = (origin: string | null) => ({
  ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = keys.default || Object.values(keys)[0];
  if (typeof key !== "string") throw new Error("Supabase server key is unavailable");
  return key;
}

function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function makeBackend(): TelegramAuthBackend {
  const client = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const toMapping = (row: any): Mapping => ({
    id: Number(row.telegram_user_id), userId: row.user_id,
    username: row.username, displayName: row.display_name,
  });
  return {
    async findByTelegramId(id) {
      const { data, error } = await client.from("telegram_accounts").select("telegram_user_id,user_id,username,display_name").eq("telegram_user_id", id).maybeSingle();
      if (error) throw error;
      return data ? toMapping(data) : null;
    },
    async findByUserId(id) {
      const { data, error } = await client.from("telegram_accounts").select("telegram_user_id,user_id,username,display_name").eq("user_id", id).maybeSingle();
      if (error) throw error;
      return data ? toMapping(data) : null;
    },
    async insertMapping(mapping) {
      const { error } = await client.from("telegram_accounts").insert({
        telegram_user_id: mapping.id, user_id: mapping.userId,
        username: mapping.username, display_name: mapping.displayName,
      });
      if (!error) return "inserted";
      if (error.code === "23505") return "conflict";
      throw error;
    },
    async updateTelegramProfile(identity) {
      const { error } = await client.from("telegram_accounts").update({ username: identity.username, display_name: identity.displayName }).eq("telegram_user_id", identity.id);
      if (error) throw error;
    },
    async getAuthUser(id) {
      const { data, error } = await client.auth.admin.getUserById(id);
      if (error) return null;
      return { id: data.user.id, email: data.user.email };
    },
    async verifyAccessToken(token) {
      const { data, error } = await client.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id, email: data.user.email };
    },
    async createAuthUser(email, displayName) {
      const { data, error } = await client.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: displayName ? { display_name: displayName } : {},
      });
      return { user: data.user ? { id: data.user.id, email: data.user.email } : null, errorCode: error?.code };
    },
    async deleteAuthUser(id) { const { error } = await client.auth.admin.deleteUser(id); if (error) throw error; },
    async inspectProfile(id) {
      const [{ data: profile, error }, { count, error: artistError }] = await Promise.all([
        client.from("profiles").select("role").eq("id", id).maybeSingle(),
        client.from("artists").select("id", { count: "exact", head: true }).eq("linked_profile_id", id),
      ]);
      if (error || artistError || !profile) return null;
      return { role: profile.role, artistCount: count ?? 0 };
    },
    async generateMagicLink(email) {
      const { data, error } = await client.auth.admin.generateLink({ type: "magiclink", email });
      return error ? null : data.properties.hashed_token;
    },
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 401, origin);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "Malformed request" }, 400, origin);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "Malformed request" }, 400, origin);

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: "Malformed request" }, 400, origin);
    const body = JSON.parse(rawBody);
    if (!body || typeof body !== "object" || !["bootstrap", "link", "register"].includes(body.action) || typeof body.initData !== "string") {
      return json({ error: "Malformed request" }, 400, origin);
    }
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) throw new Error("Telegram secret is unavailable");
    const identity = await verifyTelegramInitData(body.initData, botToken);
    const service = new TelegramAuthService(makeBackend());
    const result = body.action === "bootstrap"
      ? await service.bootstrap(identity)
      : body.action === "link"
      ? await service.link(identity, bearerToken(request.headers.get("Authorization")))
      : await service.register(identity);
    return json(result, 200, origin);
  } catch (error) {
    if (error instanceof TelegramAuthError || error instanceof UnauthorizedError) return json({ error: "Authentication failed" }, 401, origin);
    if (error instanceof LinkConflictError) return json({ error: "Account link conflict" }, 409, origin);
    if (error instanceof SyntaxError) return json({ error: "Malformed request" }, 400, origin);
    console.error("telegram-auth request failed", error instanceof InternalAuthError ? error.message : "internal_error");
    return json({ error: "Internal server error" }, 500, origin);
  }
});
