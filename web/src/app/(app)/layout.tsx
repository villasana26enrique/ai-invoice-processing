import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { Button, Muted, NavDownload, NavLink, TopBar } from "@/components/ui";
import { logout } from "../actions";

// Every page in (app) shares this header and requires a session
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <>
      <TopBar>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/?status=needs_review" className="font-semibold">Invoice Review</Link>
          <nav className="flex flex-wrap gap-1">
            {/* An invoice page belongs to the inbox: you got there from it */}
            <NavLink href="/?status=needs_review" sections={["/", "/invoices"]}>Inbox</NavLink>
            <NavLink href="/upload" sections={["/upload"]}>Upload</NavLink>
            <NavDownload href="/export.csv">Export approved (CSV)</NavDownload>
          </nav>
          <form action={logout} className="ml-auto flex items-center gap-3 text-sm">
            <Muted>{session.user}</Muted>
            <Button variant="outline" size="sm">Sign out</Button>
          </form>
        </div>
      </TopBar>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}
