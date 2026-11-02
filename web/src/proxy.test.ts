import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";
import { SESSION_COOKIE, signSession } from "./lib/session";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3010${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

describe("proxy", () => {
  it("sends a visitor without a session to the login", async () => {
    const response = await proxy(request("/invoices/1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3010/login");
  });

  it("sends a tampered session to the login", async () => {
    const token = await signSession("reviewer");
    const response = await proxy(request("/", token.slice(0, -2) + "xx"));
    expect(response.headers.get("location")).toBe("http://localhost:3010/login");
  });

  it("lets a valid session through", async () => {
    const response = await proxy(request("/", await signSession("reviewer")));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  // The matcher decides which paths reach the proxy at all
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  it.each(["/", "/invoices/12", "/upload", "/files/12", "/export.csv"])("guards %s", (path) => {
    expect(matcher.test(path)).toBe(true);
  });
  it.each(["/login", "/_next/static/chunk.js", "/favicon.ico"])("leaves %s open", (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});
