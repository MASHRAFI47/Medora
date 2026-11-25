import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLOWED_TYPES: Record<string, { ext: string; magicCheck: (buf: Buffer) => boolean }> = {
  "image/png": {
    ext: ".png",
    magicCheck: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  "image/jpeg": {
    ext: ".jpg",
    magicCheck: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  "image/webp": {
    ext: ".webp",
    magicCheck: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  "application/pdf": {
    ext: ".pdf",
    magicCheck: (b) => b.length >= 5 && b.subarray(0, 5).toString("ascii") === "%PDF-",
  },
};

export interface ValidatedUpload {
  storedFilename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hex: string;
}

export function getPrivateUploadDir(): string {
  return path.join(process.cwd(), "storage", "uploads");
}

export async function validateAndSaveUpload(file: File): Promise<ValidatedUpload> {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("No valid file provided.");
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error("File size must be between 1 byte and 2 MB.");
  }

  const rule = ALLOWED_TYPES[file.type];
  if (!rule) {
    throw new Error("Unsupported file type. Allowed: PNG, JPEG, WebP, or PDF.");
  }

  const rawName = path.basename(file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const ext = path.extname(rawName).toLowerCase();
  const validExts = rule.ext === ".jpg" ? [".jpg", ".jpeg"] : [rule.ext];
  if (ext && !validExts.includes(ext)) {
    throw new Error("File extension does not match declared content type.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Uploaded file exceeds 2 MB size limit.");
  }

  if (!rule.magicCheck(buffer)) {
    throw new Error("File signature verification failed: content does not match declared file type.");
  }

  const sha256Hex = crypto.createHash("sha256").update(buffer).digest("hex");
  const storedFilename = `${crypto.randomUUID()}${rule.ext}`;

  const uploadDir = getPrivateUploadDir();
  await fs.mkdir(uploadDir, { recursive: true });
  const destination = path.resolve(uploadDir, storedFilename);
  if (!destination.startsWith(path.resolve(uploadDir) + path.sep)) {
    throw new Error("Invalid storage path.");
  }

  await fs.writeFile(destination, buffer, { mode: 0o600 });

  return {
    storedFilename,
    originalFilename: rawName,
    mimeType: file.type,
    sizeBytes: buffer.length,
    sha256Hex,
  };
}
