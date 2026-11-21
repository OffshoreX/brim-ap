import { handle, requireRole } from "@/server/authz";
import { IdempotencyError } from "@/server/idempotency";
import { UploadError } from "@/server/files";
import { uploadAndProcess } from "@/server/upload";

export const POST = (request: Request) =>
  handle(async () => {
    const user = requireRole(request, ["employee", "ap_clerk", "controller_admin"]);
    const form = await request.formData().catch(() => null);
    if (!form) return Response.json({ error: "expected multipart form data" }, { status: 400 });
    const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
    try {
      const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) })));
      return Response.json(await uploadAndProcess(user, inputs, request.headers.get("idempotency-key")));
    } catch (e) {
      if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof IdempotencyError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });
