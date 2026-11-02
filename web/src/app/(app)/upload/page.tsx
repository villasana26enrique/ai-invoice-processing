import { requireSession } from "@/lib/auth";
import { Card, Heading, Muted } from "@/components/ui";
import { UploadForm } from "./upload-form";

export default async function UploadPage() {
  await requireSession();
  return (
    <Card className="mx-auto max-w-lg p-6">
      <Heading>Upload an invoice</Heading>
      <Muted className="mt-1 block text-sm">
        A PDF or a photo of a supplier invoice. It is read and checked in a few seconds; if everything adds up it is
        approved on its own, otherwise you will see what needs a look.
      </Muted>
      <UploadForm />
    </Card>
  );
}
