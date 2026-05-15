/** Valori canonici esito_finale (ordine UI). */
export const ESITO_FINALE_VALUES = [
  "Accordo",
  "Mancato accordo",
  "In corso",
  "Chiusa d'ufficio",
  "Ritirata",
  "Nessuna risposta",
  "Non consegnabile",
] as const;

export type EsitoFinale = (typeof ESITO_FINALE_VALUES)[number];

/** Opzioni per filtri elenco (value = label). */
export const ESITO_FINALE_FILTER_OPTIONS = ESITO_FINALE_VALUES.map((label) => ({
  value: label,
  label,
}));

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const ALIASES: Record<string, EsitoFinale> = {
  accordo: "Accordo",
  "mancato accordo": "Mancato accordo",
  "in corso": "In corso",
  "chiusa d'ufficio": "Chiusa d'ufficio",
  "chiusa d ufficio": "Chiusa d'ufficio",
  ritirata: "Ritirata",
  "nessuna risposta": "Nessuna risposta",
  "non consegnabile": "Non consegnabile",
  improcedibile: "Ritirata",
};

const BY_KEY = new Map<string, EsitoFinale>(
  ESITO_FINALE_VALUES.map((v) => [normalizeKey(v), v])
);

/** Normalizza testo esito (Excel, import massivo, varianti maiuscole). */
export function normalizeEsitoFinale(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const key = normalizeKey(trimmed);
  return ALIASES[key] ?? BY_KEY.get(key) ?? trimmed;
}

/** Opzioni select modifica mediazione (include vuoto). */
export const ESITO_FINALE_FORM_OPTIONS = ["", ...ESITO_FINALE_VALUES] as const;
