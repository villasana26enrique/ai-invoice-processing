// Signed session cookie: base64url({ user, exp }) + "." + HMAC-SHA256 with SESSION_SECRET.
// Web Crypto, so the same code runs in the proxy and in server components.
export const SESSION_COOKIE = "invoice_review_session";
export const SESSION_HOURS = 12;

export type Session = { user: string; exp: number };

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (at least 32 characters)");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(user: string): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify({ user, exp: Date.now() + SESSION_HOURS * 3600_000 })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

// null when missing, tampered with or expired
export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    Buffer.from(signature, "base64url"),
    encoder.encode(payload),
  );
  if (!valid) return null;
  const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
  return session.exp > Date.now() ? session : null;
}
