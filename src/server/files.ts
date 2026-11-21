import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Carries the HTTP status so routes stay thin.
export class UploadError extends Error {
  status = 400 as const;
}

// Type comes from the file's first bytes, not the client's name or MIME header, which can lie.
function detectExt(b: Buffer): "pdf" | "png" | "jpg" | null {
  if (b.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  return null;
}

// Throws on an unsupported type, so callers can check every file before anything is stored.
export function inspectUpload(bytes: Buffer): { sha: string; ext: string } {
  const ext = detectExt(bytes);
  if (!ext) throw new UploadError("Only PDF, PNG or JPG files are accepted");
  return { sha: createHash("sha256").update(bytes).digest("hex"), ext };
}

// Name is the content hash, so identical bytes land on the same file and are stored once.
export function storeUpload(bytes: Buffer, name: string): string {
  const dir = process.env.UPLOAD_DIR || "data/uploads";
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return file;
}
