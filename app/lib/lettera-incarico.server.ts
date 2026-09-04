import { createReport } from "docx-templates";
import JSZip from "jszip";
import type PocketBase from "pocketbase";
import { convertDocxToPdf } from "~/lib/gotenberg.server";

export const MODELLO_LETTERA_INCARICO_NOME = "Lettera incarico mediatore";
export const TIPO_LETTERA_INCARICO_NOME = "Lettera di incarico";
const LETTERA_OBSOLETA_PREFIX = "OBSOLETA";

type FirmaImage = {
  width: number;
  height: number;
  data: Buffer;
  extension: ".png" | ".jpg" | ".jpeg" | ".gif";
};

function sanitizeFilePart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80)
    .toLowerCase();
}

function letterData(
  mediatore: { name?: string; sesso?: string },
  mediazione: { rgm?: string },
): Record<string, string> {
  const female = String(mediatore.sesso ?? "").toLowerCase() === "female";
  const nome = String(mediatore.name ?? "").trim();
  const rgm = String(mediazione.rgm ?? "").trim();
  return {
    Dott_sa: female ? "Dott.ssa " : "Dott. ",
    nome_mediatore: nome,
    RGM: rgm,
    il_sottoscritto_la_sottoscritta: female ? "La sottoscritta" : "Il sottoscritto",
    lo_la: female ? "la" : "lo",
    designato_a: female ? "designata" : "designato",
  };
}

async function transformDocxXml(
  docxBuffer: Buffer,
  transform: (xml: string) => string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);
  for (const entry of Object.keys(zip.files)) {
    if (!entry.startsWith("word/") || !entry.endsWith(".xml")) continue;
    const xmlFile = zip.file(entry);
    if (!xmlFile) continue;
    zip.file(entry, transform(await xmlFile.async("string")));
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

/** Turn `<FIRMA_MEDIATORE>` into an IMAGE command inside the DOCX XML (not the zip bytes). */
async function prepareFirmaCommand(template: Buffer, hasFirma: boolean): Promise<Buffer> {
  return transformDocxXml(template, (xml) => {
    if (hasFirma) {
      return xml
        .split("&lt;FIRMA_MEDIATORE&gt;")
        .join("&lt;IMAGE FIRMA_MEDIATORE&gt;")
        .split("<FIRMA_MEDIATORE>")
        .join("<IMAGE FIRMA_MEDIATORE>")
        .split("&lt;&lt;FIRMA_MEDIATORE&gt;&gt;")
        .join("&lt;IMAGE FIRMA_MEDIATORE&gt;")
        .split("<<FIRMA_MEDIATORE>>")
        .join("<IMAGE FIRMA_MEDIATORE>");
    }
    return xml
      .split("&lt;FIRMA_MEDIATORE&gt;")
      .join("")
      .split("<FIRMA_MEDIATORE>")
      .join("")
      .split("&lt;&lt;FIRMA_MEDIATORE&gt;&gt;")
      .join("")
      .split("<<FIRMA_MEDIATORE>>")
      .join("")
      .split("&lt;IMAGE FIRMA_MEDIATORE&gt;")
      .join("")
      .split("<IMAGE FIRMA_MEDIATORE>")
      .join("");
  });
}

async function fillWithDelimiters(
  template: Buffer,
  data: Record<string, unknown>,
  cmdDelimiter: [string, string],
): Promise<Buffer> {
  const result = await createReport({
    template,
    data,
    cmdDelimiter,
    failFast: false,
    rejectNullish: false,
    fixSmartQuotes: true,
  });
  return Buffer.isBuffer(result) ? result : Buffer.from(result);
}

/**
 * Fill the lettera incarico DOCX the same way Talento fills legacy letters:
 * docx-templates with `<campo>` / `<<campo>>` delimiters (handles Word-split runs).
 */
export async function fillLetteraIncaricoDocx(
  templateBuffer: Buffer,
  textData: Record<string, string>,
  firma: FirmaImage | null,
): Promise<Buffer> {
  let doc = await prepareFirmaCommand(templateBuffer, Boolean(firma));
  const data: Record<string, unknown> = { ...textData };
  if (firma) data.FIRMA_MEDIATORE = firma;

  // Support both <<campo>> and <campo>
  doc = await fillWithDelimiters(doc, data, ["<<", ">>"]);
  doc = await fillWithDelimiters(doc, data, ["<", ">"]);
  return doc;
}

async function fetchPbFileBuffer(
  pb: PocketBase,
  record: { id: string; [k: string]: unknown },
  filename: string,
): Promise<Buffer | null> {
  if (!filename) return null;
  try {
    const token = await pb.files.getToken();
    const url = pb.files.getUrl(record as never, filename, { token });
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function firmaExtent(buf: Buffer): { width: number; height: number } {
  const widthCm = 5.5;
  let aspect = 0.35;
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w > 0 && h > 0) aspect = h / w;
  }
  return { width: widthCm, height: Math.max(1.2, Math.min(3.5, widthCm * aspect)) };
}

async function findOrCreateTipoId(pb: PocketBase, nome: string): Promise<string> {
  const existing = await pb.collection("documenti_tipi").getList(1, 1, {
    filter: `nome = "${nome.replace(/"/g, '\\"')}"`,
  });
  if (existing.items[0]) return existing.items[0].id;
  const created = await pb.collection("documenti_tipi").create({
    nome,
    attivo: true,
  });
  return created.id;
}

async function markLettereObsolete(
  pb: PocketBase,
  mediazioneId: string,
  tipoId: string,
  nuovoMediatoreName: string,
): Promise<void> {
  const docs = await pb.collection("documenti").getFullList({
    filter: `mediazione = "${mediazioneId}" && tipo = "${tipoId}"`,
    sort: "-created",
  });
  const note = `${LETTERA_OBSOLETA_PREFIX} — mediazione riassegnata a un nuovo mediatore (${nuovoMediatoreName}) il ${new Date().toLocaleDateString("it-IT")}. Conservata solo per storico.`;
  for (const d of docs) {
    const desc = String((d as { descrizione?: string }).descrizione ?? "").trim();
    if (desc.startsWith(LETTERA_OBSOLETA_PREFIX)) continue;
    await pb.collection("documenti").update(d.id, {
      descrizione: desc ? `${note}\n${desc}` : note,
    });
  }
}

/**
 * Generate filled PDF lettera di incarico and attach it to the mediazione.
 */
export async function createLetteraIncaricoForMediazione(
  pb: PocketBase,
  mediazioneId: string,
  opts?: { riassegnazione?: boolean },
): Promise<{ ok: true; documentoId: string } | { ok: false; error: string }> {
  try {
    const mediazione = await pb.collection("mediazioni").getOne(mediazioneId);
    const mediatoreId = String(mediazione.mediatore ?? "");
    if (!mediatoreId) {
      return { ok: false, error: "mediazione senza mediatore" };
    }

    const mediatore = await pb.collection("users").getOne(mediatoreId);
    const modelli = await pb.collection("modelli_documenti").getList(1, 1, {
      filter: `nome = "${MODELLO_LETTERA_INCARICO_NOME.replace(/"/g, '\\"')}" && attivo = true`,
      sort: "-updated",
    });
    let modello = modelli.items[0];
    if (!modello) {
      const any = await pb.collection("modelli_documenti").getList(1, 1, {
        filter: `nome = "${MODELLO_LETTERA_INCARICO_NOME.replace(/"/g, '\\"')}"`,
        sort: "-updated",
      });
      modello = any.items[0];
    }
    if (!modello?.file) {
      return {
        ok: false,
        error: `modello "${MODELLO_LETTERA_INCARICO_NOME}" non trovato: caricalo in Impostazioni`,
      };
    }

    const templateBuf = await fetchPbFileBuffer(pb, modello, String(modello.file));
    if (!templateBuf) {
      return { ok: false, error: "impossibile scaricare il modello lettera" };
    }

    let firma: FirmaImage | null = null;
    const firmaName = String((mediatore as { firma?: string }).firma ?? "");
    if (firmaName) {
      const firmaBuf = await fetchPbFileBuffer(pb, mediatore, firmaName);
      if (firmaBuf) {
        const lower = firmaName.toLowerCase();
        const extRaw: FirmaImage["extension"] =
          lower.endsWith(".jpg") || lower.endsWith(".jpeg")
            ? ".jpg"
            : lower.endsWith(".gif")
              ? ".gif"
              : ".png";
        const { width, height } = firmaExtent(firmaBuf);
        firma = { width, height, data: firmaBuf, extension: extRaw };
      }
    }

    const textData = letterData(
      {
        name: String(mediatore.name ?? ""),
        sesso: String((mediatore as { sesso?: string }).sesso ?? ""),
      },
      { rgm: String(mediazione.rgm ?? "") },
    );

    const filledDocx = await fillLetteraIncaricoDocx(templateBuf, textData, firma);
    const pdf = await convertDocxToPdf([filledDocx]);
    if (!pdf) {
      return { ok: false, error: "conversione PDF fallita (Gotenberg)" };
    }

    const tipoId = await findOrCreateTipoId(pb, TIPO_LETTERA_INCARICO_NOME);
    if (opts?.riassegnazione) {
      await markLettereObsolete(pb, mediazioneId, tipoId, String(mediatore.name ?? ""));
    }

    const rgm = String(mediazione.rgm ?? "").trim();
    const safeName = sanitizeFilePart(String(mediatore.name ?? ""));
    const parts = ["Lettera_incarico"];
    if (safeName) parts.push(safeName);
    if (rgm) parts.push(`RGM_${sanitizeFilePart(rgm)}`);
    const outName = `${parts.join("_")}.pdf`;

    const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
    const form = new FormData();
    form.append("mediazione", mediazioneId);
    form.append("tipo", tipoId);
    form.append(
      "descrizione",
      `Lettera di incarico per ${String(mediatore.name ?? "").trim()} (RGM ${rgm})`,
    );
    form.append("file", blob, outName);

    const doc = await pb.collection("documenti").create(form);
    return { ok: true, documentoId: doc.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Generate letters for many mediazioni after batch assign. */
export async function createLettereIncaricoForMediazioni(
  pb: PocketBase,
  mediazioneIds: string[],
  opts?: { riassegnazione?: boolean },
): Promise<{ ok: string[]; errors: Array<{ id: string; error: string }> }> {
  const ok: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];
  for (const id of mediazioneIds) {
    const res = await createLetteraIncaricoForMediazione(pb, id, opts);
    if (res.ok) ok.push(id);
    else errors.push({ id, error: res.error });
  }
  return { ok, errors };
}
