import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkCredentials } from "./auth";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

// The password goes through the real script, typed at its prompt, so a change there that breaks logins fails here
const PASSWORD = `p@$$!w0rd "quoted" \`tick\` ñ`;
const hashFromScript = (first: string, second = first) =>
  execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../scripts/hash-password.mjs")], {
    input: `${first}\n${second}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  }).toString().trim();

describe("checkCredentials", () => {
  beforeEach(() => {
    vi.stubEnv("REVIEWER_USERNAME", "reviewer");
    vi.stubEnv("REVIEWER_PASSWORD_HASH", hashFromScript(PASSWORD));
  });

  it("accepts the password hashed by scripts/hash-password.mjs, special characters included", async () => {
    expect(await checkCredentials("reviewer", PASSWORD)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    expect(await checkCredentials("reviewer", PASSWORD + "x")).toBe(false);
  });

  it("rejects a wrong user name with the right password", async () => {
    expect(await checkCredentials("someone", PASSWORD)).toBe(false);
  });

  it("fails loudly when the hash is not configured", async () => {
    vi.stubEnv("REVIEWER_PASSWORD_HASH", "");
    await expect(checkCredentials("reviewer", PASSWORD)).rejects.toThrow(/REVIEWER_PASSWORD_HASH/);
  });
});

describe("hash-password.mjs", () => {
  it("prints scrypt:<salt>:<hash>", () => {
    expect(hashFromScript(PASSWORD)).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it("uses a new salt each time", () => {
    expect(hashFromScript(PASSWORD)).not.toBe(hashFromScript(PASSWORD));
  });

  it.each([["too short", "short1", "short1"], ["mismatch", PASSWORD, PASSWORD + "x"]])(
    "exits with an error on %s", (_, first, second) => {
      expect(() => hashFromScript(first, second)).toThrow();
    });
});
