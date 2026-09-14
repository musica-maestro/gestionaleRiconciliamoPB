/** Valori canonici esito_finale (ordine UI). */
export const ESITO_FINALE_VALUES = ["Accordo", "Mancato accordo", "Chiusa d'ufficio", "Ritirata", "Nessuna risposta", "Nessuna adesione"] as const;

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
  "Nessuna adesione": "#111827", // black
};

export const CALENDAR_COLOR_DA_NOTIFICARE = "#facc15"; // yellow
export const CALENDAR_COLOR_NO_ESITO = "#d1d5db"; // light gray

/** Valori stato raccomandata sulle convocazioni (derivati dall'esito). */
export const STATO_RACCOMANDATA_VALUES = ["Consegnata", "Non consegnabile"] as const;

export type StatoRaccomandata = (typeof STATO_RACCOMANDATA_VALUES)[number];

/** Esiti raccomandata (Poste Italiane) — singoli, inclusa la consegna. */
export const ESITO_RACCOMANDATA_VALUES = [
  "Consegnata",
  "Destinatario irreperibile",
  "Destinatario deceduto",
  "Destinatario sconosciuto",
  "Destinatario trasferito",
  "Invio rifiutato",
  "Indirizzo inesatto",
  "Indirizzo inesistente",
  "Indirizzo insufficiente",
  "Al mittente per compiuta giacenza",
] as const;

/** @deprecated Usare ESITO_RACCOMANDATA_VALUES */
export const MOTIVO_RACCOMANDATA_VALUES = ESITO_RACCOMANDATA_VALUES;

/** Da esito UI → stato + motivo salvati su convocazioni. */
export function splitEsitoRaccomandata(esito: string): {
  stato_raccomandata: string;
  motivo_raccomandata: string;
} {
  const v = esito.trim();
  if (!v) return { stato_raccomandata: "", motivo_raccomandata: "" };
  if (v === "Consegnata") return { stato_raccomandata: "Consegnata", motivo_raccomandata: "" };
  return { stato_raccomandata: "Non consegnabile", motivo_raccomandata: v };
}

/** Da stato+motivo salvati → valore select esito. */
export function joinEsitoRaccomandata(
  stato?: string | null,
  motivo?: string | null
): string {
  if (stato === "Consegnata") return "Consegnata";
  if (motivo?.trim()) return motivo.trim();
  if (stato === "Non consegnabile") return "";
  return stato?.trim() || "";
}

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
  nr: "Nessuna risposta",
  "mancata comparizione": "Nessuna risposta",
  "nessuna adesione": "Nessuna adesione",
  improcedibile: "Ritirata",
  // legacy: treat old "In corso" / "Non consegnabile" as empty (moved to stato_raccomandata)
};

const BY_KEY = new Map<string, EsitoFinale>(ESITO_FINALE_VALUES.map((v) => [normalizeKey(v), v]));

/** Normalizza testo esito (Excel, import massivo, varianti maiuscole). */
export function normalizeEsitoFinale(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const key = normalizeKey(trimmed);
  // Legacy / aperti: non sono esiti finali
  if (key === "in corso" || key === "non consegnabile" || key === "aperta" || key === "esito gestionale") {
    return "";
  }
  return ALIASES[key] ?? BY_KEY.get(key) ?? trimmed;
}

/** Opzioni select modifica mediazione (include vuoto). */
export const ESITO_FINALE_FORM_OPTIONS = ["", ...ESITO_FINALE_VALUES] as const;

/** Colore evento calendario da esito / stato / adesione. */
export function calendarEventColor(opts: { esitoFinale?: string | null; stato?: string | null; adesione?: boolean }): string {
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
