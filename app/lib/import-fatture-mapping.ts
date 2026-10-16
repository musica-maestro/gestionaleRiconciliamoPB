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

/**
 * Fuzzy person/company key: abbreviations, legal forms, trailing +N, compact initials.
 * e.g. "ALLEV.TO VALMADRERA" → "allevamento valmadrera"
 *      "R.T.I. SPA" → "rti spa"
 *      "LUCISANO F. +1" → "lucisano f"
 */
export function fuzzyPersonKey(value: string): string {
  let s = normalizePersonKey(value);
  s = s
    .replace(/\ballev\s*to\b/g, "allevamento")
    .replace(/\ballevamento\b/g, "allevamento")
    .replace(/\bs\s*r\s*l\b/g, "srl")
    .replace(/\bs\s*p\s*a\b/g, "spa")
    .replace(/\+\s*\d+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Compact single-letter runs: "r t i spa" → "rti spa"
  s = s.replace(/\b([a-z])(?:\s+([a-z]))+\b/g, (m) => m.replace(/\s+/g, ""));
  return s;
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost
      );
    }
  }
  return dp[a.length]![b.length]!;
}

/** Score 0–100 how well Excel cliente matches a soggetto label. */
export function scoreClienteLabel(cliente: string, label: string): number {
  const ek = fuzzyPersonKey(cliente);
  const lk = fuzzyPersonKey(label);
  if (!ek || !lk) return 0;
  if (ek === lk) return 100;
  if (lk.includes(ek) || ek.includes(lk)) return 85;

  const et = ek.split(" ").filter(Boolean);
  const lt = lk.split(" ").filter(Boolean);
  if (!et.length || !lt.length) return 0;

  // Company: high overlap of significant tokens (len>=3)
  const etSig = et.filter((t) => t.length >= 2);
  const ltSig = lt.filter((t) => t.length >= 2);
  let overlap = 0;
  for (const t of etSig) {
    if (ltSig.some((l) => l === t || l.startsWith(t) || t.startsWith(l) || editDistance(l, t) <= 1)) {
      overlap++;
    }
  }
  if (etSig.length && overlap === etSig.length) return 88;
  if (etSig.length >= 2 && overlap >= etSig.length - 0) return 80;

  // Cognome-first Excel ("RICCI C", "LUCISANO F") vs full name
  const cogE = et[0]!;
  const restE = et.slice(1);
  const cogLLast = lt[lt.length - 1]!;
  const cogLFirst = lt[0]!;
  const nomesL = lt.length > 1 ? lt.slice(0, -1) : [];
  const nomesL2 = lt.slice(1);

  let sc = 0;
  const cogMatch =
    cogE === cogLLast ||
    cogE === cogLFirst ||
    editDistance(cogE, cogLLast) <= 1 ||
    editDistance(cogE, cogLFirst) <= 1;
  if (cogMatch) {
    sc = restE.length === 0 ? 70 : 60;
    for (const r of restE) {
      if (r.length === 1) {
        if (nomesL.some((n) => n.startsWith(r)) || nomesL2.some((n) => n.startsWith(r))) sc = 92;
      } else if (
        nomesL.includes(r) ||
        nomesL2.includes(r) ||
        nomesL.some((n) => editDistance(n, r) <= 1) ||
        nomesL2.some((n) => editDistance(n, r) <= 1)
      ) {
        sc = 95;
      }
    }
  }

  // Slash-separated "LUCISANO/TUCCI M" — score against either side
  if (cliente.includes("/")) {
    const parts = cliente.split("/").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      sc = Math.max(sc, scoreClienteLabel(part, label));
    }
  }

  const ratio = (overlap / Math.max(etSig.length, ltSig.length, 1)) * 75;
  return Math.max(sc, ratio);
}

/**
 * Normalize RGM keys:
 * - `0001-2025` / `1-2025` → `1-2025`
 * - `1362--2025` → `1362-2025`
 * - `609-206` → `609-2026` (with yearHint from sheet, or 2XY → 202Y)
 * - `664-202` → uses yearHint (sheet year) when year part is truncated
 */
export function normalizeRgmKey(rgm: string, yearHint?: number): string {
  const s = String(rgm ?? "").trim().replace(/-+/g, "-");
  let m = s.match(/^0*(\d+)\s*[-/]\s*(\d{4})$/);
  if (m) return `${Number(m[1])}-${m[2]}`;

  m = s.match(/^0*(\d+)\s*[-/]\s*(\d{1,3})$/);
  if (m) {
    const num = Number(m[1]);
    const yRaw = m[2]!;
    if (yRaw.length === 2) {
      return `${num}-20${yRaw}`;
    }
    if (yRaw.length === 3) {
      // 025 → 2025
      if (yRaw.startsWith("0")) return `${num}-2${yRaw}`;
      // Truncated/typo years on yearly sheets: 202 → 2026, 206 → 2026
      if (yearHint) {
        const yh = String(yearHint);
        if (yh.startsWith(yRaw.slice(0, 2)) || (yRaw.startsWith("2") && yh.endsWith(yRaw.slice(-1)))) {
          return `${num}-${yearHint}`;
        }
      }
      // 206 → 2026 without hint
      if (yRaw.startsWith("2")) return `${num}-202${yRaw.slice(-1)}`;
    }
    if (yearHint) return `${num}-${yearHint}`;
  }
  return s.toLowerCase();
}

function yearHintFromSheet(sheetName: string): number | undefined {
  const m = sheetName.match(/20(23|24|25|26)/);
  return m ? Number(`20${m[1]}`) : undefined;
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
  const yearHint = yearHintFromSheet(sheetName);
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
      rgmKey: normalizeRgmKey(rgm, yearHint),
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
