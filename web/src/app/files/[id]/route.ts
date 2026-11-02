import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireSession } from "@/lib/auth";
import { getStoredFile } from "@/lib/invoices";

const FILES_DIR = process.env.FILES_DIR ?? "/data/invoices";

// The original invoice, for the review page. Only with a session, and only files the database knows about.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const id = Number((await params).id);
  const file = Number.isInteger(id) ? await getStoredFile(id) : null;
  // storage_path is "<sha256>.<ext>", written by the pipeline; anything else is refused
  if (!file || !/^[0-9a-f]{64}\.(pdf|jpg|jpeg|png|webp)$/.test(file.storage_path)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    // turbopackIgnore: the folder is only known at runtime; without it the build traces the whole project
    const content = await readFile(path.join(/* turbopackIgnore: true */ FILES_DIR, file.storage_path));
    return new Response(content, {
      headers: {
        "Content-Type": file.mime_type,
        "Content-Disposition": `inline; filename="${file.file_name.replace(/[^\w.-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("The original file is missing", { status: 404 });
  }
}
