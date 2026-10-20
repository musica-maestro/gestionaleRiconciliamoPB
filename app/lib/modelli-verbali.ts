import type { EsitoFinale } from "~/lib/esito-finale";
import { ESITO_FINALE_VALUES } from "~/lib/esito-finale";

/** Fixed model names in `modelli_documenti` — one verbale per esito finale (+ prosecuzione). */
export const MODELLO_VERBALE_ACCORDO = "Verbale accordo";
export const MODELLO_VERBALE_MANCATO_ACCORDO = "Verbale mancato accordo";
export const MODELLO_VERBALE_MANCATO_RISCONTRO = "Verbale Mancato riscontro";
/** @deprecated alias — stesso modello di Mancato riscontro */
export const MODELLO_VERBALE_NESSUNA_RISPOSTA = MODELLO_VERBALE_MANCATO_RISCONTRO;
export const MODELLO_VERBALE_MANCATA_COMPARIZIONE = "Verbale mancata comparizione";
export const MODELLO_VERBALE_MANCATA_ADESIONE = "Verbale mancata adesione";
export const MODELLO_VERBALE_CHIUSA_UFFICIO = "Verbale chiusa d'ufficio";
export const MODELLO_VERBALE_RITIRATA = "Verbale ritirata";
export const MODELLO_VERBALE_PROSECUZIONE = "Verbale di prosecuzione";

/** Legacy nome in `modelli_documenti` / file Word già caricati. */
export const MODELLO_VERBALE_NESSUNA_RISPOSTA_LEGACY = "Verbale Nessuna Risposta";

export type ModelloVerbaleMeta = {
  nome: string;
  /** `null` = non legato a un esito di chiusura (es. prosecuzione). */
  esito: EsitoFinale | null;
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
    nome: MODELLO_VERBALE_MANCATO_RISCONTRO,
    esito: "Mancato riscontro",
    descrizione: "Verbale Mancato riscontro (parte chiamata non aderisce / non risponde).",
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
  {
    nome: MODELLO_VERBALE_PROSECUZIONE,
    esito: null,
    descrizione: "Verbale di prosecuzione del procedimento (rinvio a nuovo incontro).",
  },
] as const;

export const MODELLI_VERBALI_NOMI = MODELLI_VERBALI_FISSI.map((m) => m.nome);

const BY_ESITO = new Map<EsitoFinale, string>(
  MODELLI_VERBALI_FISSI.filter((m) => m.esito != null).map((m) => [m.esito!, m.nome]),
);

const BY_NOME = new Map<string, ModelloVerbaleMeta>(
  MODELLI_VERBALI_FISSI.map((m) => [m.nome, m]),
);
// Legacy DB / UI name → stesso meta del Mancato riscontro
BY_NOME.set(MODELLO_VERBALE_NESSUNA_RISPOSTA_LEGACY, {
  nome: MODELLO_VERBALE_MANCATO_RISCONTRO,
  esito: "Mancato riscontro",
  descrizione: "Verbale Mancato riscontro (parte chiamata non aderisce / non risponde).",
});

export function modelloVerbaleNomeForEsito(esito: string | null | undefined): string | null {
  const v = String(esito ?? "").trim() as EsitoFinale;
  if (!ESITO_FINALE_VALUES.includes(v)) return null;
  return BY_ESITO.get(v) ?? null;
}

export function modelloVerbaleMetaByNome(nome: string): ModelloVerbaleMeta | null {
  return BY_NOME.get(nome) ?? null;
}

/**
 * Resolve the `modelli_documenti.nome` to load.
 * Accepts the new canonical name and the legacy "Verbale Nessuna Risposta".
 */
export function resolveModelloDocumentiNome(nome: string): string {
  if (nome === MODELLO_VERBALE_NESSUNA_RISPOSTA_LEGACY) {
    return MODELLO_VERBALE_MANCATO_RISCONTRO;
  }
  return nome;
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
    name: "TITOLO_MEDIATORE",
    source: "users.sesso (mediatore)",
    note: 'female → "Mediatrice Dott.ssa", altrimenti "Mediatore Dott."',
  },
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
    name: "PEC_AVV_ISTANTE",
    source: "avvocati.pec (istante)",
    note: "PEC dell'avvocato istante",
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
  {
    name: "NOME_CHIAMATO",
    source: "soggetti.nome (PF) oppure ragione_sociale (PG)",
    note: "Nome chiamato; se PG contiene la ragione sociale",
  },
  {
    name: "COGNOME_CHIAMATO",
    source: "soggetti.cognome (PF); vuoto se PG",
    note: "Cognome chiamato (vuoto per persona giuridica)",
  },
  {
    name: "CHIAMATO",
    source: "nome+cognome oppure ragione_sociale",
    note: "Nome completo chiamato (un solo campo)",
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
  {
    name: "NUMERO_RACCOMANDATA_CHIAMATO",
    source: "convocazioni.numero_raccomandata (parte chiamata, raccomandata migliore)",
    note: "N. raccomandata inviata al chiamato",
  },
  {
    name: "DATA_INVIO_RACCOMANDATA_CHIAMATO",
    source: "convocazioni.data_invio (parte chiamata, raccomandata migliore)",
    note: "Data invio raccomandata al chiamato (dd/MM/yyyy)",
  },
  {
    name: "ESITO_RACCOMANDATA_CHIAMATO",
    source: "convocazioni.stato_raccomandata + motivo_raccomandata (join)",
    note: "Esito della raccomandata di conciliazione (es. Consegnata, Destinatario irreperibile…)",
  },
] as const;

export const VERBALE_MERGE_FIELD_NAMES = VERBALE_MERGE_FIELDS.map((f) => f.name);

/** Placeholder as it must appear in the Word file, e.g. `#RGM#`. */
export function verbalePlaceholder(name: string): string {
  return `#${name}#`;
}
