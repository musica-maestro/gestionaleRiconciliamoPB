/**
 * Duck-type check for an uploaded file from FormData.
 * Avoids `instanceof File` which throws ReferenceError on Node < 20
 * when the global File constructor is missing.
 */
export function isUploadedFile(
  value: FormDataEntryValue | null
): value is Blob & { name: string; size: number } {
  if (value == null || typeof value === "string") return false;
  const v = value as { size?: unknown; name?: unknown };
  return (
    typeof v.size === "number" &&
    v.size > 0 &&
    typeof v.name === "string" &&
    v.name.length > 0
  );
}

/**
 * Convert a canvas data URL (data:image/png;base64,...) into a Blob for PocketBase upload.
 */
export function dataUrlToFirmaBlob(
  dataUrl: string
): { blob: Blob; filename: string } | null {
  const trimmed = dataUrl.trim();
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(trimmed);
  if (!m) return null;
  const mime = m[1].trim() || "image/png";
  if (!mime.startsWith("image/")) return null;
  try {
    const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    if (buf.length < 32 || buf.length > 2_500_000) return null;
    const blob = new Blob([buf], { type: mime });
    const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
    return { blob, filename: `firma.${ext}` };
  } catch {
    return null;
  }
}
