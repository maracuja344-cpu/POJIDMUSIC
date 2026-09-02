export const MAX_INIT_DATA_BYTES = 8_192;
export const MAX_AUTH_AGE_SECONDS = 300;
export const MAX_FUTURE_SKEW_SECONDS = 30;
const MAX_TELEGRAM_ID = Number.MAX_SAFE_INTEGER;
const encoder = new TextEncoder();

export type TelegramIdentity = {
  id: number;
  username: string | null;
  displayName: string | null;
};

export class TelegramAuthError extends Error {}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeHexEqual(actual: string, expected: string): boolean {
  const left = encoder.encode(actual.toLowerCase());
  const right = encoder.encode(expected.toLowerCase());
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return difference === 0;
}

async function hmacSha256(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

export async function telegramHash(initDataWithoutHash: URLSearchParams, botToken: string): Promise<string> {
  const pairs: string[] = [];
  for (const [key, value] of initDataWithoutHash.entries()) {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  }
  pairs.sort((left, right) => left.localeCompare(right));
  const secret = await hmacSha256(encoder.encode("WebAppData"), botToken);
  return bytesToHex(await hmacSha256(new Uint8Array(secret), pairs.join("\n")));
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export async function verifyTelegramInitData(
  rawInitData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TelegramIdentity> {
  if (!rawInitData || encoder.encode(rawInitData).byteLength > MAX_INIT_DATA_BYTES) {
    throw new TelegramAuthError("Invalid Telegram authentication data");
  }

  const params = new URLSearchParams(rawInitData);
  const hashes = params.getAll("hash");
  const authDates = params.getAll("auth_date");
  const users = params.getAll("user");
  if (hashes.length !== 1 || authDates.length !== 1 || users.length !== 1) {
    throw new TelegramAuthError("Invalid Telegram authentication data");
  }
  if (!/^[a-fA-F0-9]{64}$/.test(hashes[0])) {
    throw new TelegramAuthError("Invalid Telegram authentication data");
  }

  const expectedHash = await telegramHash(params, botToken);
  if (!constantTimeHexEqual(hashes[0], expectedHash)) {
    throw new TelegramAuthError("Invalid Telegram authentication data");
  }

  if (!/^\d{1,12}$/.test(authDates[0])) {
    throw new TelegramAuthError("Invalid Telegram authentication data");
  }
  const authDate = Number(authDates[0]);
  if (authDate < nowSeconds - MAX_AUTH_AGE_SECONDS || authDate > nowSeconds + MAX_FUTURE_SKEW_SECONDS) {
    throw new TelegramAuthError("Invalid Telegram authentication data");
  }

  let user: Record<string, unknown>;
  try {
    user = JSON.parse(users[0]);
  } catch {
    throw new TelegramAuthError("Invalid Telegram authentication data");
  }
  if (
    typeof user !== "object" || user === null ||
    typeof user.id !== "number" || !Number.isSafeInteger(user.id) ||
    user.id <= 0 || user.id > MAX_TELEGRAM_ID
  ) {
    throw new TelegramAuthError("Invalid Telegram authentication data");
  }

  const firstName = optionalText(user.first_name, 128);
  const lastName = optionalText(user.last_name, 128);
  return {
    id: user.id,
    username: optionalText(user.username, 64),
    displayName: [firstName, lastName].filter(Boolean).join(" ").slice(0, 256) || null,
  };
}
