/** Valori canonici esito_finale (ordine UI). */
export const ESITO_FINALE_VALUES = [
  "Accordo",
  "Mancato accordo",
  "Chiusa d'ufficio",
  "Ritirata",
  "Nessuna risposta",
  "Non consegnabile",
  "Nessuna adesione",
] as const;

export type EsitoFinale = (typeof ESITO_FINALE_VALUES)[number];

/** Opzioni per filtri elenco (value = label). */
export const ESITO_FINALE_FILTER_OPTIONS = ESITO_FINALE_VALUES.map((label) => ({
  value: label,
  label,
}));

/** Colori calendario / legenda per esito. */
export const ESITO_FINALE_COLORS: Record<EsitoFinale, string> = {
  Accordo: "#38bdf8", // skyblue
  "Mancato accordo": "#1e3a8a", // dark blue
  "Chiusa d'ufficio": "#86efac", // light green
  Ritirata: "#166534", // dark green
  "Nessuna risposta": "#ec4899", // pink
  "Non consegnabile": "#dc2626", // red
  "Nessuna adesione": "#111827", // black
};

export const CALENDAR_COLOR_DA_NOTIFICARE = "#facc15"; // yellow
export const CALENDAR_COLOR_NO_ESITO = "#d1d5db"; // light gray

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const ALIASES: Record<string, EsitoFinale> = {
  accordo: "Accordo",
  "mancato accordo": "Mancato accordo",
  "chiusa d'ufficio": "Chiusa d'ufficio",
  "chiusa d ufficio": "Chiusa d'ufficio",
  ritirata: "Ritirata",
  "nessuna risposta": "Nessuna risposta",
  "non consegnabile": "Non consegnabile",
  "nessuna adesione": "Nessuna adesione",
  improcedibile: "Ritirata",
  // legacy: treat old "In corso" as empty (open)
};

const BY_KEY = new Map<string, EsitoFinale>(
  ESITO_FINALE_VALUES.map((v) => [normalizeKey(v), v])
);

/** Normalizza testo esito (Excel, import massivo, varianti maiuscole). */
export function normalizeEsitoFinale(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const key = normalizeKey(trimmed);
  if (key === "in corso") return "";
  return ALIASES[key] ?? BY_KEY.get(key) ?? trimmed;
}

/** Opzioni select modifica mediazione (include vuoto). */
export const ESITO_FINALE_FORM_OPTIONS = ["", ...ESITO_FINALE_VALUES] as const;

/** Colore evento calendario da esito / stato / adesione. */
export function calendarEventColor(opts: {
  esitoFinale?: string | null;
  stato?: string | null;
  adesione?: boolean;
}): string {
  const esito = String(opts.esitoFinale ?? "").trim();
  if (esito && esito in ESITO_FINALE_COLORS) {
    return ESITO_FINALE_COLORS[esito as EsitoFinale];
  }
  const stato = String(opts.stato ?? "");
  if (stato === "da_notificare" || stato === "pianificata") {
    return CALENDAR_COLOR_DA_NOTIFICARE;
  }
  if (!esito && opts.adesione === false) {
    return ESITO_FINALE_COLORS["Nessuna adesione"];
  }
  return CALENDAR_COLOR_NO_ESITO;
}

/** Testo leggibile su sfondo chiaro/scuro. */
export function calendarEventTextColor(bg: string): string {
  const hex = bg.replace("#", "");
  if (hex.length !== 6) return "#fff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1f2937" : "#ffffff";
}
