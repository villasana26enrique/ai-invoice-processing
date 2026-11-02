import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// First line of defense: without a valid session, every page goes to the login.
// Pages, actions and file routes check the session again (requireSession).
export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  const login = new URL("/login", request.url);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
