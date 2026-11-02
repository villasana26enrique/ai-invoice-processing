import "server-only";
import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession, type Session } from "./session";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

// REVIEWER_PASSWORD_HASH is "scrypt:<salt hex>:<hash hex>" (scripts/hash-password.mjs)
export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const [scheme, salt, hash] = (process.env.REVIEWER_PASSWORD_HASH ?? "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) throw new Error("REVIEWER_PASSWORD_HASH is not set");
  const expected = Buffer.from(hash, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length);
  const sameUser = username === (process.env.REVIEWER_USERNAME ?? "");
  // Always compare the password too, so a wrong user name takes as long as a wrong password
  return timingSafeEqual(actual, expected) && sameUser;
}

// Every page, action and file route calls this: the proxy redirects early, but it is not the only guard
export async function requireSession(): Promise<Session> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  return session;
}
