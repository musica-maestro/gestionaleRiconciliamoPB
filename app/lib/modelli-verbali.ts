import type { EsitoFinale } from "~/lib/esito-finale";
import { ESITO_FINALE_VALUES } from "~/lib/esito-finale";

/** Fixed model names in `modelli_documenti` — one verbale per esito finale. */
export const MODELLO_VERBALE_ACCORDO = "Verbale accordo";
export const MODELLO_VERBALE_MANCATO_ACCORDO = "Verbale mancato accordo";
export const MODELLO_VERBALE_NESSUNA_RISPOSTA = "Verbale Nessuna Risposta";
export const MODELLO_VERBALE_MANCATA_COMPARIZIONE = "Verbale mancata comparizione";
export const MODELLO_VERBALE_MANCATA_ADESIONE = "Verbale mancata adesione";
export const MODELLO_VERBALE_CHIUSA_UFFICIO = "Verbale chiusa d'ufficio";
export const MODELLO_VERBALE_RITIRATA = "Verbale ritirata";

export type ModelloVerbaleMeta = {
  nome: string;
  esito: EsitoFinale;
  descrizione: string;
};

export const MODELLI_VERBALI_FISSI: readonly ModelloVerbaleMeta[] = [
  {
    nome: MODELLO_VERBALE_ACCORDO,
    esito: "Accordo",
    descrizione: "Verbale di chiusura con accordo tra le parti.",
  },
  {
    nome: MODELLO_VERBALE_MANCATO_ACCORDO,
    esito: "Mancato accordo",
    descrizione: "Verbale di chiusura per mancato raggiungimento dell'accordo.",
  },
  {
    nome: MODELLO_VERBALE_NESSUNA_RISPOSTA,
    esito: "Nessuna risposta",
    descrizione: "Verbale Nessuna Risposta (parte chiamata non aderisce / non risponde).",
  },
  {
    nome: MODELLO_VERBALE_MANCATA_COMPARIZIONE,
    esito: "Mancata comparizione",
    descrizione: "Verbale per mancata comparizione della parte.",
  },
  {
    nome: MODELLO_VERBALE_MANCATA_ADESIONE,
    esito: "Mancata adesione",
    descrizione: "Verbale per mancata adesione formale al procedimento.",
  },
  {
    nome: MODELLO_VERBALE_CHIUSA_UFFICIO,
    esito: "Chiusa d'ufficio",
    descrizione: "Verbale di chiusura d'ufficio.",
  },
  {
    nome: MODELLO_VERBALE_RITIRATA,
    esito: "Ritirata",
    descrizione: "Verbale di mediazione ritirata.",
  },
] as const;

export const MODELLI_VERBALI_NOMI = MODELLI_VERBALI_FISSI.map((m) => m.nome);

const BY_ESITO = new Map<EsitoFinale, string>(
  MODELLI_VERBALI_FISSI.map((m) => [m.esito, m.nome]),
);

const BY_NOME = new Map<string, ModelloVerbaleMeta>(
  MODELLI_VERBALI_FISSI.map((m) => [m.nome, m]),
);

export function modelloVerbaleNomeForEsito(esito: string | null | undefined): string | null {
  const v = String(esito ?? "").trim() as EsitoFinale;
  if (!ESITO_FINALE_VALUES.includes(v)) return null;
  return BY_ESITO.get(v) ?? null;
}

export function modelloVerbaleMetaByNome(nome: string): ModelloVerbaleMeta | null {
  return BY_NOME.get(nome) ?? null;
}

/**
 * Placeholder names for verbale Word templates.
 * In the .docx use `#NOME#` (leading `#` so they are easy to find with Ctrl+F).
 * Legacy MERGEFIELD with the same names is still supported.
 */
export const VERBALE_MERGE_FIELDS = [
  { name: "RGM", source: "mediazioni.rgm", note: "Numero RGM" },
  { name: "COMPETENZA", source: "mediazioni.competenza", note: "Competenza territoriale" },
  { name: "VALORE", source: "mediazioni.valore", note: "Scaglione / valore" },
  { name: "OGGETTO", source: "mediazioni.oggetto (+ materia_altro se Altro)", note: "Materia / oggetto" },
  { name: "ANNO", source: "incontri.data_programmazione (Europe/Rome)", note: "Anno dell'incontro" },
  { name: "GIORNO", source: "incontri.data_programmazione", note: "Giorno (numero)" },
  { name: "MESE", source: "incontri.data_programmazione", note: "Mese in italiano (es. gennaio)" },
  { name: "ORE", source: "incontri.data_programmazione", note: "Ora HH:MM" },
  { name: "MEDIATORE", source: "users.name (mediatore)", note: "Nome mediatore" },
  {
    name: "DATA_DEPOSITO",
    source: "mediazioni.data_deposito || data_protocollo",
    note: "Data deposito dd/MM/yyyy (Europe/Rome)",
  },
  {
    name: "ISTANTE",
    source: "primo istante (nome+cognome o ragione sociale)",
    note: "Parte istante",
  },
  { name: "CF_ISTANTE", source: "soggetti.codice_fiscale (istante)", note: "CF / P.IVA istante" },
  {
    name: "AVV_ISTANTE",
    source: "primo avvocato dell'istante (nome+cognome)",
    note: "Avvocato parte istante (i modelli storici riusano questo campo anche per il chiamato)",
  },
  {
    name: "Foro_",
    source: "avvocati.foro_di_appartenenza (istante)",
    note: "Foro di appartenenza avvocato istante",
  },
  {
    name: "Tessera",
    source: "avvocati.numero_tessera_foro (istante)",
    note: "N. tessera foro avvocato istante",
  },
  { name: "NOME_CHIAMATO", source: "soggetti.nome (primo chiamato PF)", note: "Nome chiamato" },
  {
    name: "COGNOME_CHIAMATO",
    source: "soggetti.cognome o ragione_sociale (PG)",
    note: "Cognome chiamato / RS se giuridica",
  },
  { name: "CF_CHIAMATO", source: "soggetti.codice_fiscale (chiamato)", note: "CF chiamato" },
  {
    name: "AVV_CHIAMATO",
    source: "primo avvocato del chiamato",
    note: "Opzionale per modelli nuovi (non presente nei template stampa unione attuali)",
  },
  {
    name: "Foro_Chiamato",
    source: "avvocati.foro_di_appartenenza (chiamato)",
    note: "Opzionale per modelli nuovi",
  },
  {
    name: "Tessera_Chiamato",
    source: "avvocati.numero_tessera_foro (chiamato)",
    note: "Opzionale per modelli nuovi",
  },
] as const;

export const VERBALE_MERGE_FIELD_NAMES = VERBALE_MERGE_FIELDS.map((f) => f.name);

/** Placeholder as it must appear in the Word file, e.g. `#RGM#`. */
export function verbalePlaceholder(name: string): string {
  return `#${name}#`;
}
