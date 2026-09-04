const GOTENBERG_URL = process.env.GOTENBERG_URL ?? "https://pdf.f5-lab.com";
const GOTENBERG_USER = process.env.GOTENBERG_USER ?? "lziKbnAzOmriGwGX";
const GOTENBERG_PASS = process.env.GOTENBERG_PASS ?? "M4HkEfpb4020jWnACAYUTj1u0U5revRw";
const GOTENBERG_AUTH =
  "Basic " + Buffer.from(`${GOTENBERG_USER}:${GOTENBERG_PASS}`).toString("base64");

const GOTENBERG_MAX_CONCURRENT = 2;
let gCount = 0;
const gQueue: Array<() => void> = [];

function acquireGotenberg(): Promise<void> {
  if (gCount < GOTENBERG_MAX_CONCURRENT) {
    gCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => gQueue.push(resolve));
}

function releaseGotenberg(): void {
  const next = gQueue.shift();
  if (next) next();
  else gCount--;
}

/**
 * Convert one or more DOCX buffers to a single PDF via Gotenberg (LibreOffice).
 * Same approach as Talento `lesive.raccomandate.export`.
 */
export async function convertDocxToPdf(docxBufs: Buffer[]): Promise<Buffer | null> {
  if (docxBufs.length === 0) return null;
  await acquireGotenberg();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      try {
        const form = new FormData();
        docxBufs.forEach((buf, i) =>
          form.append(
            "files",
            new Blob([new Uint8Array(buf)], {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }),
            `document_${i}.docx`,
          ),
        );
        if (docxBufs.length > 1) form.append("merge", "true");
        const res = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
          method: "POST",
          body: form,
          signal: controller.signal,
          headers: { Authorization: GOTENBERG_AUTH },
        });
        if (res.status === 503 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 3_000));
          continue;
        }
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  } finally {
    releaseGotenberg();
  }
}
