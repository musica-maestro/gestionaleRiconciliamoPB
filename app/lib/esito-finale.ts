/** Valori canonici esito_finale (ordine UI). */
export const ESITO_FINALE_VALUES = [
  "Accordo",
  "Mancato accordo",
  "Mancata comparizione",
  "Mancata adesione",
  "Nessuna risposta",
  "Chiusa d'ufficio",
  "Ritirata",
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
  "Mancata comparizione": "#7c3aed", // violet
  "Mancata adesione": "#111827", // black
  "Nessuna risposta": "#ec4899", // pink
  "Chiusa d'ufficio": "#86efac", // light green
  Ritirata: "#166534", // dark green
};

/** Stato adesione esplicito su mediazioni (campo DB `stato_adesione`). */
export const STATO_ADESIONE_VALUES = [
  "in_attesa",
  "adesione",
  "mancata_adesione",
] as const;

export type StatoAdesione = (typeof STATO_ADESIONE_VALUES)[number];

export const STATO_ADESIONE_LABELS: Record<StatoAdesione, string> = {
  in_attesa: "In attesa",
  adesione: "Adesione",
  mancata_adesione: "Mancata adesione",
};

/** Stati display calendario (stato_adesione + chiusa; esiti restano separati). */
export const CALENDAR_STATO_VALUES = [
  "in_attesa",
  "adesione",
  "mancata_adesione",
  "chiusa",
] as const;

export type CalendarStatoKey = (typeof CALENDAR_STATO_VALUES)[number];

export const CALENDAR_STATO_COLORS: Record<CalendarStatoKey, string> = {
  in_attesa: "#d1d5db", // light gray
  adesione: "#38bdf8", // sky
  mancata_adesione: "#111827", // black — same as esito, distinta in legenda
  chiusa: "#94a3b8", // slate
};

export const CALENDAR_STATO_LABELS: Record<CalendarStatoKey, string> = {
  in_attesa: "In attesa",
  adesione: "Adesione",
  mancata_adesione: "Mancata adesione",
  chiusa: "Chiusa",
};

/** Sync helper: bool `adesione` derivato da stato_adesione. */
export function adesioneFromStato(stato: string | null | undefined): boolean {
  return normalizeStatoAdesione(stato) === "adesione";
}

export function normalizeStatoAdesione(raw: string | null | undefined): StatoAdesione {
  const v = String(raw ?? "").trim();
  if ((STATO_ADESIONE_VALUES as readonly string[]).includes(v)) return v as StatoAdesione;
  return "in_attesa";
}

/** Patch DB per impostare stato_adesione + sync bool adesione. */
export function statoAdesionePatch(stato: StatoAdesione): {
  stato_adesione: StatoAdesione;
  adesione: boolean;
} {
  return {
    stato_adesione: stato,
    adesione: stato === "adesione",
  };
}

/** @deprecated legacy yellow; calendar no longer uses Da convocare */
export const CALENDAR_COLOR_DA_NOTIFICARE = "#facc15";
/** @deprecated use CALENDAR_STATO_COLORS.in_attesa */
export const CALENDAR_COLOR_NO_ESITO = CALENDAR_STATO_COLORS.in_attesa;

export type CalendarStatusKey = CalendarStatoKey | EsitoFinale;

export function calendarColorKey(opts: {
  esitoFinale?: string | null;
  stato?: string | null;
  /** Campo esplicito mediazioni.stato_adesione */
  statoAdesione?: string | null;
  /** @deprecated fallback se statoAdesione assente */
  adesione?: boolean;
  /** True when data_chiusura + esito are set. */
  chiusa?: boolean;
  meetingStartMs?: number | null;
  nowMs?: number;
}): CalendarStatusKey {
  const esito = String(opts.esitoFinale ?? "").trim();

  // Esito di chiusura ha priorità (inclusa Mancata adesione come esito)
  if (esito && esito in ESITO_FINALE_COLORS) {
    return esito as EsitoFinale;
  }

  if (opts.chiusa) return "chiusa";

  const sa = String(opts.statoAdesione ?? "").trim();
  if (sa === "adesione") return "adesione";
  if (sa === "mancata_adesione") return "mancata_adesione";
  if (sa === "in_attesa") return "in_attesa";

  // Fallback legacy: solo bool adesione
  if (opts.adesione === true) return "adesione";

  return "in_attesa";
}

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

export type EsitoRaccomandata = (typeof ESITO_RACCOMANDATA_VALUES)[number];

/** Esiti che → verbale Nessuna Risposta (se incontro passato e no adesione). */
export const ESITI_RACCOMANDATA_VERBALE_NR = [
  "Invio rifiutato",
  "Al mittente per compiuta giacenza",
  "Consegnata",
] as const;

/** Esiti che → comunicazione mancata consegna ad avvocato istante. */
export const ESITI_RACCOMANDATA_MANCATA_CONSEGNA = [
  "Indirizzo inesatto",
  "Indirizzo inesistente",
  "Indirizzo insufficiente",
  "Destinatario irreperibile",
  "Destinatario deceduto",
  "Destinatario sconosciuto",
  "Destinatario trasferito",
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
  "mancata comparizione": "Mancata comparizione",
  "nessuna adesione": "Mancata adesione",
  "mancata adesione": "Mancata adesione",
  improcedibile: "Ritirata",
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

/** Colore evento calendario da esito / stato_adesione. */
export function calendarEventColor(opts: {
  esitoFinale?: string | null;
  stato?: string | null;
  statoAdesione?: string | null;
  adesione?: boolean;
  chiusa?: boolean;
  meetingStartMs?: number | null;
  nowMs?: number;
}): string {
  const key = calendarColorKey(opts);
  if (key in CALENDAR_STATO_COLORS) {
    return CALENDAR_STATO_COLORS[key as CalendarStatoKey];
  }
  return ESITO_FINALE_COLORS[key as EsitoFinale];
}

/** Etichetta legenda / agenda per lo stato colore. */
export function calendarColorLabel(key: CalendarStatusKey): string {
  if (key in CALENDAR_STATO_LABELS) {
    return CALENDAR_STATO_LABELS[key as CalendarStatoKey];
  }
  return key;
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

/** Tipi azione post-esito raccomandata. */
export const AZIONE_RACCOMANDATA_VALUES = [
  "verbale_nessuna_risposta",
  "comunicazione_mancata_consegna",
] as const;

export type AzioneRaccomandata = (typeof AZIONE_RACCOMANDATA_VALUES)[number];

export const AZIONE_RACCOMANDATA_STATO_VALUES = ["da_fare", "evasa"] as const;
export type AzioneRaccomandataStato = (typeof AZIONE_RACCOMANDATA_STATO_VALUES)[number];

export const AZIONE_RACCOMANDATA_LABELS: Record<AzioneRaccomandata, string> = {
  verbale_nessuna_risposta: "Verbale Nessuna Risposta",
  comunicazione_mancata_consegna: "Comunicazione mancata consegna",
};
