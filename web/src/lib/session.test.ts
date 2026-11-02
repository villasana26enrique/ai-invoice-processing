import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_HOURS, signSession, verifySession } from "./session";

const decode = (token: string) => JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());

afterEach(() => vi.useRealTimers());

describe("session cookie", () => {
  it("round-trips the user name", async () => {
    const token = await signSession("reviewer");
    expect(await verifySession(token)).toMatchObject({ user: "reviewer" });
  });

  it("expires after SESSION_HOURS", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-02T12:00:00Z") });
    const token = await signSession("reviewer");
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z").getTime() + SESSION_HOURS * 3600_000 - 1000);
    expect(await verifySession(token)).not.toBeNull();
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z").getTime() + SESSION_HOURS * 3600_000 + 1000);
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects a payload changed by hand", async () => {
    const [, signature] = (await signSession("reviewer")).split(".");
    const forged = Buffer.from(JSON.stringify({ user: "admin", exp: Date.now() + 3600_000 })).toString("base64url");
    expect(await verifySession(`${forged}.${signature}`)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession("reviewer");
    vi.stubEnv("SESSION_SECRET", "another-secret-that-is-long-enough-987654");
    expect(await verifySession(token)).toBeNull();
    vi.unstubAllEnvs();
  });

  it.each([undefined, "", "garbage", "a.", ".b", "a.b"])("returns null for %j", async (token) => {
    expect(await verifySession(token)).toBeNull();
  });

  it("refuses to sign with a short secret", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    await expect(signSession("reviewer")).rejects.toThrow(/SESSION_SECRET/);
    vi.unstubAllEnvs();
  });

  it("stores only the user and the expiry", async () => {
    expect(Object.keys(decode(await signSession("reviewer"))).sort()).toEqual(["exp", "user"]);
  });
});
