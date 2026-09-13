/**
 * Load-back after Flusso export: Alfared CSV → convocazioni (raccomandata chiamato + PEC istante),
 * PDF/ZIP → documenti "Contenuto raccomandata" on the mediazione (tipo + descrizione + file).
 */
import type PocketBase from "pocketbase";
import JSZip from "jszip";
import { STATO_RACCOMANDATA_VALUES, type StatoRaccomandata } from "~/lib/esito-finale";

export const TIPO_CONTENUTO_RACCOMANDATA = "Contenuto raccomandata";

const COLUMN_MAPPINGS = {
  id_lesive: ["id_lesive", "lesiva", "id lesiva", "id lesive", "id mediazione", "mediazione"],
  link_gestionale: ["link gestionale", "link_gestionale"],
  mittente: ["mittente"],
  destinatario: ["destinatario"],
  numero_lettera: [
    "numero lettera",
    "numero_lettera",
    "numero",
    "numero raccomandata",
    "numero_raccomandata",
  ],
  link_tracciamento: [
    "link",
    "link tracciamento",
    "link_tracciamento",
    "tracciamento",
    "link status",
    "link_status",
    "link_tracciamento_poste",
  ],
  data_invio: [
    "data invio",
    "data_invio",
    "data spedizione",
    "data_spedizione",
    "spedita il",
  ],
  status: ["stato", "status", "stato raccomandata", "stato_raccomandata"],
} as const;

export type ParsedAlfaredRow = {
  mediazioneId: string | null;
  linkGestionale: string | null;
  mittente: string | null;
  destinatario: string | null;
  numero: string | null;
  link_status: string | null;
  data_invio: string | null;
  status: string | null;
  data_invio_iso?: string | null;
  usedDefaultNow?: boolean;
};

export type AlfaredProcessResult = {
  validRows: ParsedAlfaredRow[];
  invalidRows: Array<{ rowIndex: number; data: Record<string, string>; error: string }>;
  headers: string[];
  columnMap: Record<string, string | null>;
  existingNumeri?: string[];
};

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && c === delimiter) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
    i += 1;
  }
  result.push(current.trim());
  return result;
}

function detectCsvDelimiter(line: string): string {
  return line.includes(";") ? ";" : ",";
}

function isPocketBaseId(value: string): boolean {
  return /^[a-zA-Z0-9]{15}$/.test(value);
}

function extractUrlFromLinkCell(value: string): string {
  const s = (value || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) {
    const end = s.search(/\s|["']/);
    return end === -1 ? s : s.slice(0, end);
  }
  const urlMatch = s.match(/https?:\/\/[^")\s;,']+/);
  return urlMatch ? urlMatch[0].trim() : "";
}

function extractIdFromGestionale(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link, "http://dummy");
    const parts = url.pathname.split("/").filter(Boolean);
    const maybeId = parts[parts.length - 1];
    return maybeId && isPocketBaseId(maybeId) ? maybeId : null;
  } catch {
    const match = link.match(/([a-zA-Z0-9]{15})$/);
    return match?.[1] ?? null;
  }
}

function parseDate(dateString: string): Date | null {
  dateString = dateString.trim();
  const isoDate = new Date(dateString);
  if (!isNaN(isoDate.getTime())) return isoDate;
  const dateRegex = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/;
  const match = dateString.match(dateRegex);
  if (match) {
    const [, part1, part2, part3] = match;
    let year = parseInt(part3!, 10);
    if (part3!.length === 2) year = year < 50 ? 2000 + year : 1900 + year;
    let day = parseInt(part1!, 10);
    let month = parseInt(part2!, 10) - 1;
    const date = new Date(year, month, day);
    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
      return date;
    }
    day = parseInt(part2!, 10);
    month = parseInt(part1!, 10) - 1;
    const dateAmerican = new Date(year, month, day);
    if (
      dateAmerican.getFullYear() === year &&
      dateAmerican.getMonth() === month &&
      dateAmerican.getDate() === day
    ) {
      return dateAmerican;
    }
  }
  const excelMatch = dateString.match(/^(\d{5,6}(?:\.\d+)?)$/);
  if (excelMatch) {
    const serialDate = parseFloat(excelMatch[1]!);
    const wholeDays = Math.floor(serialDate);
    const timeFraction = serialDate - wholeDays;
    const baseDate = new Date(Date.UTC(1900, 0, wholeDays - (wholeDays > 60 ? 2 : 1)));
    if (timeFraction > 0) {
      baseDate.setTime(baseDate.getTime() + timeFraction * 24 * 60 * 60 * 1000);
    }
    if (!isNaN(baseDate.getTime())) return baseDate;
  }
  return null;
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mapStatoRaccomandata(raw: string | null): StatoRaccomandata | undefined {
  if (!raw?.trim()) return undefined;
  const key = raw.trim().toLowerCase();
  if (key.includes("consegnat") && !key.includes("non")) return "Consegnata";
  if (
    key.includes("non consegnabile") ||
    key.includes("resa") ||
    key.includes("compiuta giacenza") ||
    key.includes("destinatario sconosciuto") ||
    key.includes("indirizzo insufficiente")
  ) {
    return "Non consegnabile";
  }
  const exact = STATO_RACCOMANDATA_VALUES.find((s) => s.toLowerCase() === key);
  return exact;
}

function parseRow(
  rowData: Record<string, string>,
  columnMap: Record<string, string | null>,
): ParsedAlfaredRow {
  const result: ParsedAlfaredRow = {
    mediazioneId: null,
    linkGestionale: null,
    mittente: null,
    destinatario: null,
    numero: null,
    link_status: null,
    data_invio: null,
    status: null,
  };

  if (columnMap.id_lesive && rowData[columnMap.id_lesive]) {
    result.mediazioneId = rowData[columnMap.id_lesive]!.trim();
  }
  if (columnMap.link_gestionale && rowData[columnMap.link_gestionale]) {
    result.linkGestionale = rowData[columnMap.link_gestionale]!.trim();
  }
  if (!result.mediazioneId) {
    const extracted = extractIdFromGestionale(result.linkGestionale);
    if (extracted) result.mediazioneId = extracted;
  }
  if (columnMap.mittente && rowData[columnMap.mittente]) {
    result.mittente = rowData[columnMap.mittente]!.trim();
  }
  if (columnMap.destinatario && rowData[columnMap.destinatario]) {
    result.destinatario = rowData[columnMap.destinatario]!.trim();
  }
  if (columnMap.numero_lettera && rowData[columnMap.numero_lettera]) {
    result.numero = rowData[columnMap.numero_lettera]!.trim();
  }
  if (columnMap.link_tracciamento && rowData[columnMap.link_tracciamento]) {
    const extracted = extractUrlFromLinkCell(rowData[columnMap.link_tracciamento]!);
    result.link_status =
      extracted && (extracted.startsWith("http://") || extracted.startsWith("https://"))
        ? extracted
        : null;
  }
  if (columnMap.data_invio && rowData[columnMap.data_invio]) {
    result.data_invio = rowData[columnMap.data_invio]!.trim();
  }
  if (columnMap.status && rowData[columnMap.status]) {
    result.status = rowData[columnMap.status]!.trim();
  }
  return result;
}

function validateRow(row: ParsedAlfaredRow): { isValid: boolean; error?: string } {
  if (!row.mediazioneId?.trim()) return { isValid: false, error: "id_lesive mancante" };
  if (!isPocketBaseId(row.mediazioneId)) return { isValid: false, error: "id_lesive non valido" };
  if (!row.numero?.trim()) return { isValid: false, error: "Numero Lettera mancante" };
  if (row.data_invio?.trim()) {
    const parsedDate = parseDate(row.data_invio);
    if (!parsedDate) return { isValid: false, error: "Data Spedizione non valida" };
  }
  if (!row.link_status?.trim()) return { isValid: false, error: "Link tracciamento mancante" };
  if (!(row.link_status.startsWith("http://") || row.link_status.startsWith("https://"))) {
    return { isValid: false, error: "Link tracciamento non valido" };
  }
  return { isValid: true };
}

export async function processAlfaredCsvText(text: string): Promise<AlfaredProcessResult> {
  const validRows: ParsedAlfaredRow[] = [];
  const invalidRows: Array<{ rowIndex: number; data: Record<string, string>; error: string }> = [];

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return {
      validRows: [],
      invalidRows: [{ rowIndex: 0, data: {}, error: "File CSV vuoto o senza dati" }],
      headers: [],
      columnMap: {},
    };
  }

  const delimiter = detectCsvDelimiter(lines[0]!);
  const rows = lines.map((line) => parseCsvLine(line, delimiter));
  const headers = rows[0]!.map((h) => String(h ?? "").replace(/^"|"$/g, "").trim());
  const columnMap: Record<string, string | null> = {};
  for (const expectedColumn of Object.keys(COLUMN_MAPPINGS) as (keyof typeof COLUMN_MAPPINGS)[]) {
    const possibleHeaders = COLUMN_MAPPINGS[expectedColumn];
    const matchingHeader = headers.find((header) =>
      possibleHeaders.some((p) => header.toLowerCase().trim() === p.toLowerCase().trim()),
    );
    columnMap[expectedColumn] = matchingHeader || null;
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.length || row.every((cell) => !cell)) continue;
    const rowData: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowData[header] = String(row[index] ?? "").replace(/^"|"$/g, "").trim();
    });
    const parsedRow = parseRow(rowData, columnMap);
    const validation = validateRow(parsedRow);
    if (validation.isValid) {
      let dataIso: string | null = null;
      let usedDefaultNow = false;
      if (parsedRow.data_invio) {
        const parsed = parseDate(parsedRow.data_invio);
        dataIso = parsed ? toDateOnly(parsed) : null;
      } else {
        dataIso = toDateOnly(new Date());
        usedDefaultNow = true;
      }
      validRows.push({ ...parsedRow, data_invio_iso: dataIso, usedDefaultNow });
    } else {
      invalidRows.push({
        rowIndex: i,
        data: rowData,
        error: validation.error || "Errore sconosciuto",
      });
    }
  }

  return { validRows, invalidRows, headers, columnMap };
}

export async function processAlfaredFiles(files: File[]): Promise<AlfaredProcessResult> {
  const allValid: ParsedAlfaredRow[] = [];
  const allInvalid: AlfaredProcessResult["invalidRows"] = [];
  let headers: string[] = [];
  let columnMap: Record<string, string | null> = {};
  let globalRowIndex = 0;

  for (const file of files) {
    const result = await processAlfaredCsvText(await file.text());
    if (result.headers.length) {
      headers = result.headers;
      columnMap = result.columnMap;
    }
    for (const row of result.validRows) {
      allValid.push(row);
      globalRowIndex++;
    }
    for (const inv of result.invalidRows) {
      allInvalid.push({ ...inv, rowIndex: globalRowIndex });
      globalRowIndex++;
    }
  }

  return { validRows: allValid, invalidRows: allInvalid, headers, columnMap };
}

async function findOrCreateTipoContenuto(pb: PocketBase): Promise<string> {
  const existing = await pb.collection("documenti_tipi").getList(1, 1, {
    filter: `nome = "${TIPO_CONTENUTO_RACCOMANDATA.replace(/"/g, '\\"')}"`,
  });
  if (existing.items[0]) return existing.items[0].id;
  try {
    const created = await pb.collection("documenti_tipi").create({
      nome: TIPO_CONTENUTO_RACCOMANDATA,
      descrizione: "PDF inviato con raccomandata (caricato dopo export Flusso / Alfared)",
      attivo: true,
    });
    return created.id;
  } catch (e) {
    const again = await pb.collection("documenti_tipi").getList(1, 1, {
      filter: `nome = "${TIPO_CONTENUTO_RACCOMANDATA.replace(/"/g, '\\"')}"`,
    });
    if (again.items[0]) return again.items[0].id;
    throw new Error(
      `Tipo documento "${TIPO_CONTENUTO_RACCOMANDATA}" mancante: crealo in Impostazioni (solo admin)`,
    );
  }
}

async function findChiamatoPartecipazione(
  pb: PocketBase,
  mediazioneId: string,
): Promise<string | null> {
  try {
    const list = await pb.collection("partecipazioni").getList(1, 5, {
      filter: `mediazione = "${mediazioneId}" && istante_o_chiamato = "Chiamato"`,
      sort: "created",
    });
    return list.items[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function findIstantePartecipazione(
  pb: PocketBase,
  mediazioneId: string,
): Promise<string | null> {
  try {
    const list = await pb.collection("partecipazioni").getList(1, 5, {
      filter: `mediazione = "${mediazioneId}" && istante_o_chiamato = "Istante"`,
      sort: "created",
    });
    return list.items[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function markMediazioneAperta(pb: PocketBase, mediazioneId: string): Promise<void> {
  try {
    const m = await pb.collection("mediazioni").getOne(mediazioneId, { fields: "id,stato" });
    const stato = String(m.stato ?? "");
    if (stato === "da_notificare" || stato === "pianificata") {
      await pb.collection("mediazioni").update(mediazioneId, { stato: "aperta" });
    }
  } catch {
    // ignore
  }
}

function buildContenutoDescrizione(opts: {
  numero: string;
  destinatario: string | null;
  dataInvio: string;
}): string {
  const parts = [`Raccomandata n. ${opts.numero}`];
  if (opts.destinatario?.trim()) parts.push(opts.destinatario.trim());
  if (opts.dataInvio) {
    const [y, m, d] = opts.dataInvio.split("-");
    const pretty =
      y && m && d ? `${d}/${m}/${y}` : opts.dataInvio;
    parts.push(`inviata ${pretty}`);
  }
  return parts.join(" · ");
}

async function findExistingContenutoDocumento(
  pb: PocketBase,
  mediazioneId: string,
  tipoId: string,
  numero: string,
): Promise<boolean> {
  const numeroEscaped = numero.replace(/"/g, '\\"');
  try {
    await pb.collection("documenti").getFirstListItem(
      `mediazione = "${mediazioneId}" && tipo = "${tipoId}" && descrizione ~ "${numeroEscaped}"`,
    );
    return true;
  } catch {
    return false;
  }
}

async function createContenutoDocumento(
  pb: PocketBase,
  opts: {
    mediazioneId: string;
    tipoId: string;
    numero: string;
    destinatario: string | null;
    dataInvio: string;
    pdf: { name: string; blob: Blob };
  },
): Promise<"created" | "skipped"> {
  if (
    await findExistingContenutoDocumento(
      pb,
      opts.mediazioneId,
      opts.tipoId,
      opts.numero,
    )
  ) {
    return "skipped";
  }

  const form = new FormData();
  form.append("mediazione", opts.mediazioneId);
  form.append("tipo", opts.tipoId);
  form.append(
    "descrizione",
    buildContenutoDescrizione({
      numero: opts.numero,
      destinatario: opts.destinatario,
      dataInvio: opts.dataInvio,
    }),
  );
  form.append("file", opts.pdf.blob, `${opts.mediazioneId}.pdf`);
  await pb.collection("documenti").create(form);
  return "created";
}

export async function importConvocazioniFromAlfared(
  pb: PocketBase,
  rows: ParsedAlfaredRow[],
  opts: {
    createPecIstante?: boolean;
    /** PDF keyed by mediazione id — required for each raccomandata row */
    pdfByMediazioneId: Map<string, { name: string; blob: Blob }>;
  },
): Promise<{
  created: number;
  skipped: number;
  pecCreated: number;
  documentiCreated: number;
  errors: string[];
}> {
  const createPec = opts.createPecIstante !== false;
  const pdfByMediazioneId = opts.pdfByMediazioneId;
  let created = 0;
  let skipped = 0;
  let pecCreated = 0;
  let documentiCreated = 0;
  const errors: string[] = [];
  const today = toDateOnly(new Date());
  const mediazioniToOpen = new Set<string>();
  const pecDone = new Set<string>();
  const tipoId = await findOrCreateTipoContenuto(pb);

  for (const row of rows) {
    const mediazioneId = row.mediazioneId!;
    const numero = row.numero!;
    try {
      try {
        await pb.collection("mediazioni").getOne(mediazioneId, { fields: "id" });
      } catch {
        errors.push(`${numero}: mediazione ${mediazioneId} non trovata`);
        skipped++;
        continue;
      }

      const pdf = pdfByMediazioneId.get(mediazioneId);
      if (!pdf) {
        errors.push(
          `${numero}: manca il PDF (${mediazioneId}.pdf) nello ZIP — riga non importata`,
        );
        skipped++;
        continue;
      }

      const dataInvio = row.data_invio_iso || today;
      const numeroEscaped = numero.replace(/"/g, '\\"');
      let convocazioneAlreadyExists = false;
      try {
        await pb.collection("convocazioni").getFirstListItem(
          `numero_raccomandata = "${numeroEscaped}" && tipologia = "Raccomandata"`,
        );
        convocazioneAlreadyExists = true;
      } catch {
        // not found — create
      }

      if (!convocazioneAlreadyExists) {
        const chiamatoId = await findChiamatoPartecipazione(pb, mediazioneId);
        if (!chiamatoId) {
          errors.push(`${numero}: nessun chiamato su mediazione ${mediazioneId}`);
          skipped++;
          continue;
        }

        const statoRaccomandata = mapStatoRaccomandata(row.status);
        await pb.collection("convocazioni").create({
          partecipazione: chiamatoId,
          tipologia: "Raccomandata",
          numero_raccomandata: numero,
          link_tracciamento_poste: row.link_status || undefined,
          data_invio: dataInvio,
          data_caricamento: today,
          stato_raccomandata: statoRaccomandata,
          nota: row.destinatario
            ? `Destinatario Alfared: ${row.destinatario}`
            : undefined,
        });
        created++;
        mediazioniToOpen.add(mediazioneId);
      } else {
        skipped++;
      }

      // Document always lands in Documenti (idempotent by mediazione + tipo + numero in descrizione)
      try {
        const docResult = await createContenutoDocumento(pb, {
          mediazioneId,
          tipoId,
          numero,
          destinatario: row.destinatario,
          dataInvio,
          pdf,
        });
        if (docResult === "created") documentiCreated++;
      } catch (e) {
        errors.push(
          `${numero}: documento non creato — ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (createPec && !pecDone.has(mediazioneId)) {
        pecDone.add(mediazioneId);
        const istanteId = await findIstantePartecipazione(pb, mediazioneId);
        if (istanteId) {
          let hasPec = false;
          try {
            await pb.collection("convocazioni").getFirstListItem(
              `partecipazione = "${istanteId}" && tipologia = "PEC"`,
            );
            hasPec = true;
          } catch {
            hasPec = false;
          }
          if (!hasPec) {
            await pb.collection("convocazioni").create({
              partecipazione: istanteId,
              tipologia: "PEC",
              data_invio: dataInvio,
              data_caricamento: today,
              nota: "PEC all'istante confermata con load-back Flusso",
            });
            pecCreated++;
          }
        }
      }
    } catch (e) {
      errors.push(`${numero}: ${e instanceof Error ? e.message : String(e)}`);
      skipped++;
    }
  }

  for (const mid of mediazioniToOpen) {
    await markMediazioneAperta(pb, mid);
  }

  return { created, skipped, pecCreated, documentiCreated, errors };
}

function mediazioneIdFromFilename(name: string): string | null {
  const base = name.replace(/^.*\//, "").replace(/\.[^/.]+$/, "").trim();
  return base && isPocketBaseId(base) ? base : null;
}

/** Index PDF blobs by mediazione id (filename without extension). */
export function indexPdfsByMediazioneId(
  files: Array<{ name: string; blob: Blob }>,
): Map<string, { name: string; blob: Blob }> {
  const map = new Map<string, { name: string; blob: Blob }>();
  for (const file of files) {
    const id = mediazioneIdFromFilename(file.name);
    if (id) map.set(id, file);
  }
  return map;
}

/** Collect PDF blobs from loose files and/or ZIP (incl. nested _pdf.zip). */
export async function collectPdfsFromUploads(
  files: File[],
): Promise<Array<{ name: string; blob: Blob }>> {
  const out: Array<{ name: string; blob: Blob }> = [];

  async function addFromZip(buf: ArrayBuffer, prefix = "") {
    const zip = await JSZip.loadAsync(buf);
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const lower = path.toLowerCase();
      const base = path.split("/").pop() || path;
      if (lower.endsWith(".pdf")) {
        const blob = await entry.async("blob");
        out.push({ name: prefix ? `${prefix}${base}` : base, blob });
      } else if (lower.endsWith(".zip") || base.toLowerCase() === "_pdf.zip") {
        const nested = await entry.async("arraybuffer");
        await addFromZip(nested, "");
      }
    }
  }

  for (const file of files) {
    const name = file.name || "file";
    const lower = name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      out.push({ name, blob: file });
    } else if (lower.endsWith(".zip")) {
      await addFromZip(await file.arrayBuffer());
    }
  }

  return out;
}
