import { handle, requireRole } from "@/server/authz";
import { UploadError } from "@/server/files";
import { uploadInvoices } from "@/server/invoices";

export const POST = (request: Request) =>
  handle(async () => {
    const user = requireRole(request, ["employee", "ap_clerk", "controller_admin"]);
    const form = await request.formData().catch(() => null);
    if (!form) return Response.json({ error: "expected multipart form data" }, { status: 400 });
    const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
    try {
      const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
      return Response.json(uploadInvoices(user, buffers));
    } catch (e) {
      if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });
