import { randomBytes, scryptSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session";
import { approveInvoice, login, rejectInvoice, saveInvoice, uploadInvoice } from "./actions";

// Next's request APIs, replaced by fakes. redirect() throws, like the real one, so the action stops there.
const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  set: vi.fn((name: string, value: string) => void jar.set(name, value)),
  delete: vi.fn((name: string) => void jar.delete(name)),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ callFunction: vi.fn(async () => ({ ok: true })) }));

const { callFunction } = await import("@/lib/db");

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
  const salt = randomBytes(16);
  vi.stubEnv("REVIEWER_USERNAME", "reviewer");
  vi.stubEnv("REVIEWER_PASSWORD_HASH", `scrypt:${salt.toString("hex")}:${scryptSync("right-password", salt, 32).toString("hex")}`);
  vi.stubEnv("N8N_UPLOAD_URL", "http://n8n.test/webhook/invoices");
  vi.stubEnv("UPLOAD_API_KEY", "test-key");
});

const signIn = async (user = "reviewer") => jar.set(SESSION_COOKIE, await signSession(user));

describe("login", () => {
  it("rejects a wrong password without setting a cookie", async () => {
    const result = await login(null, form({ username: "reviewer", password: "wrong-password" }));
    expect(result).toEqual({ ok: false, message: "Wrong user name or password." });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects empty fields", async () => {
    expect((await login(null, form({ username: "", password: "" }))).ok).toBe(false);
  });

  it("sets an httpOnly session cookie and goes to the inbox", async () => {
    await expect(login(null, form({ username: " reviewer ", password: "right-password" }))).rejects.toThrow("REDIRECT /");
    const [, token, options] = cookieStore.set.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(await verifySession(token)).toMatchObject({ user: "reviewer" });
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("marks the cookie secure only when COOKIE_SECURE=true", async () => {
    vi.stubEnv("COOKIE_SECURE", "true");
    await expect(login(null, form({ username: "reviewer", password: "right-password" }))).rejects.toThrow();
    expect((cookieStore.set.mock.calls[0] as unknown[])[2]).toMatchObject({ secure: true });
  });
});

describe("review actions", () => {
  it.each([
    ["saveInvoice", () => saveInvoice(1, {} as never)],
    ["approveInvoice", () => approveInvoice(1, "")],
    ["rejectInvoice", () => rejectInvoice(1, "duplicate")],
  ])("%s refuses to run without a session", async (_, action) => {
    await expect(action()).rejects.toThrow("REDIRECT /login");
    expect(callFunction).not.toHaveBeenCalled();
  });

  // The actor recorded in review_events comes from the session, never from what the browser sends
  it("records the signed-in reviewer as the actor", async () => {
    await signIn("maria");
    await approveInvoice(7, "checked by phone");
    expect(callFunction).toHaveBeenCalledWith(expect.stringContaining("approve_invoice"), [7, "maria", "checked by phone"]);
    await rejectInvoice(7, "duplicate");
    expect(callFunction).toHaveBeenLastCalledWith(expect.stringContaining("reject_invoice"), [7, "maria", "duplicate"]);
  });

  it("sends the edited invoice as JSON and returns what the database answered", async () => {
    await signIn();
    const issues = [{ code: "total_mismatch", severity: "error", field: "total", message: "Total does not add up" }];
    vi.mocked(callFunction).mockResolvedValueOnce({ ok: true, issues });
    const invoice = { invoice_number: "INV-1", lines: [] };
    expect(await saveInvoice(3, invoice as never)).toEqual({ ok: true, issues });
    expect(callFunction).toHaveBeenCalledWith(expect.stringContaining("save_review"), [3, "reviewer", JSON.stringify(invoice)]);
  });
});

describe("uploadInvoice", () => {
  const pdf = () => new File(["%PDF-1.4 test"], "test-invoice.pdf", { type: "application/pdf" });

  it("needs a session", async () => {
    await expect(uploadInvoice(null, form({ file: pdf() }))).rejects.toThrow("REDIRECT /login");
  });

  it("asks for a file when none was chosen", async () => {
    await signIn();
    expect(await uploadInvoice(null, form({ file: new File([], "") }))).toMatchObject({ ok: false });
  });

  it("posts the file to n8n with the API key and opens the new invoice", async () => {
    await signIn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true, document_id: 55 }));
    await expect(uploadInvoice(null, form({ file: pdf() }))).rejects.toThrow("REDIRECT /invoices/55");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://n8n.test/webhook/invoices");
    expect(init.headers).toEqual({ "X-API-Key": "test-key" });
    expect(((init.body as FormData).get("file") as File).name).toBe("test-invoice.pdf");
  });

  it("opens the invoice even when the model could not read it (422 with a document)", async () => {
    await signIn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: false, document_id: 56, status: "failed", message: "Model error" }, { status: 422 }));
    await expect(uploadInvoice(null, form({ file: pdf() }))).rejects.toThrow("REDIRECT /invoices/56");
  });

  it("shows n8n's message when nothing was registered", async () => {
    await signIn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: false, message: "Unsupported file type" }, { status: 400 }));
    expect(await uploadInvoice(null, form({ file: pdf() }))).toEqual({ ok: false, message: "Unsupported file type" });
  });

  it.each([
    ["n8n is down", () => Promise.reject(new TypeError("fetch failed"))],
    ["n8n answers HTML", () => Promise.resolve(new Response("<html>502</html>", { status: 502 }))],
  ])("explains the problem when %s", async (_, answer) => {
    await signIn();
    vi.spyOn(globalThis, "fetch").mockImplementation(answer);
    expect(await uploadInvoice(null, form({ file: pdf() }))).toMatchObject({ ok: false, message: expect.stringMatching(/could not be sent/) });
  });
});
