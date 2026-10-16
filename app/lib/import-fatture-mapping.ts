/**
 * Parse Excel workbook into canonical invoice upsert rows.
 * Only yearly sheets: RGM -2023, RGM-2024, RGM-2025, RGM-2026.
 * Ignores FATT.DA EMETTERE / FATTURE EMESSE.
 */

export type FatturaImportRow = {
  /** 0-based source index within the parsed list */
  index: number;
  sheet: string;
  rgm: string;
  /** Normalized key for matching (leading zeros stripped on number part) */
  rgmKey: string;
  cliente: string;
  numero_fattura: string;
  data_emissione: string | null;
  data_incasso: string | null;
  imponibile: number | null;
  descrizione: string;
};

const SKIP_RGM = /^(fatturabile|da fatturare|totale|totali?)$/i;
const SKIP_NUMERO = /^(da fatturare|fatturato|proforma|fatturabile)$/i;

/** Strip accents/spaces for loose name matching. */
export function normalizePersonKey(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** `0001-2025` and `1-2025` → `1-2025`; `08-2023` → `8-2023`. */
export function normalizeRgmKey(rgm: string): string {
  const s = String(rgm ?? "").trim();
  const m = s.match(/^0*(\d+)\s*[-/]\s*(\d{4})$/);
  if (!m) return s.toLowerCase();
  return `${Number(m[1])}-${m[2]}`;
}

export function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  let s = String(value).trim();
  if (!s || s === "-" || /^-\s*€?$/i.test(s)) return null;
  s = s.replace(/€/g, "").replace(/\s/g, "");
  // Italian: 1.234,56 → 1234.56 ; also accept 64.75
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  s = s.replace(/[^0-9.-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse IT dates (d/m/yyyy, d/m/yy) or ISO / Excel serial → YYYY-MM-DD. */
export function parseDateToISO(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30) + value * 86400000;
    const dt = new Date(epoch);
    if (!Number.isNaN(dt.getTime())) {
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const d = String(dt.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const it = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (it) {
    let y = Number(it[3]);
    if (y < 100) y += 2000;
    return `${y}-${it[2].padStart(2, "0")}-${it[1].padStart(2, "0")}`;
  }
  return null;
}

function getCell(row: Record<string, unknown>, ...aliases: string[]): unknown {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const want = alias.trim().toLowerCase();
    for (const k of keys) {
      if (k.trim().toLowerCase() === want) return row[k];
    }
  }
  return undefined;
}

function str(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function isSkippableRow(rgm: string, numero: string, imponibile: number | null): boolean {
  if (!rgm || SKIP_RGM.test(rgm)) return true;
  if (numero && SKIP_NUMERO.test(numero)) return true;
  if ((imponibile == null || imponibile === 0) && !numero) return true;
  return false;
}

type SheetKind = "rgm_year";

/** Only yearly RGM sheets (2023–2026). Ignore FATT.DA EMETTERE / FATTURE EMESSE. */
function detectSheetKind(name: string): SheetKind | null {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  // Match "RGM -2023", "RGM-2024", "RGM-2025", "RGM-2026"
  if (/^rgm\s*-?\s*20(23|24|25|26)\b/.test(n)) return "rgm_year";
  return null;
}

function mapSheetRows(
  sheetName: string,
  rawRows: Record<string, unknown>[],
  startIndex: number
): FatturaImportRow[] {
  const out: FatturaImportRow[] = [];
  let idx = startIndex;
  for (const row of rawRows) {
    const rgm = str(getCell(row, "RGM"));
    let cliente = str(getCell(row, "CLIENTE"));
    if (!cliente) cliente = str(getCell(row, "CESSIONARIO"));
    const numero = str(getCell(row, "N. FATT", "N.FATT"));
    const dataEmissione = parseDateToISO(getCell(row, "DATA"));
    const dataIncasso = parseDateToISO(getCell(row, "BONIFICO", " BONIFICO"));
    const imponibile = parseMoney(getCell(row, "IMPONIBILE", " IMPONIBILE"));

    const clienteClean = cliente.replace(/\s*\([^)]*\)\s*/g, " ").trim() || cliente;

    if (isSkippableRow(rgm, numero, imponibile)) continue;

    out.push({
      index: idx++,
      sheet: sheetName,
      rgm,
      rgmKey: normalizeRgmKey(rgm),
      cliente: clienteClean,
      numero_fattura: /^\d+$/.test(numero) ? numero : "",
      data_emissione: dataEmissione,
      data_incasso: dataIncasso,
      imponibile,
      descrizione: "",
    });
  }
  return out;
}

export function mapFattureWorkbook(
  sheets: { name: string; rows: Record<string, unknown>[] }[]
): FatturaImportRow[] {
  const yearSheets = sheets
    .filter((s) => detectSheetKind(s.name) === "rgm_year")
    .sort((a, b) => a.name.localeCompare(b.name));

  const out: FatturaImportRow[] = [];
  for (const s of yearSheets) {
    out.push(...mapSheetRows(s.name, s.rows, out.length));
  }
  return out;
}

export function yearFromISO(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})/);
  return m ? m[1] : null;
}

export function notaMatchesNumero(nota: string | undefined, numero: string, year: string | null): boolean {
  if (!nota || !numero) return false;
  const m = nota.match(/fatt\.?\s*(\d+)\s*\/\s*(\d{4})/i);
  if (!m) return false;
  if (m[1] !== numero) return false;
  if (year && m[2] !== year) return false;
  return true;
}
