/**
 * Client-safe Excel row mapping for mediazioni import (Tracciato Organismo).
 * Used by the import page for preview; server uses this + importRows for actual import.
 */
export function getStr(row: Record<string, unknown>, header: string): string {
  const key =
    header in row
      ? header
      : Object.keys(row).find((k) => k.trim() === header.trim());
  const v = key !== undefined ? row[key] : undefined;
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/** Campi indirizzo Chiamato dall’Excel (colonne separate). */
export function getIndirizzoChiamato(row: Record<string, unknown>): {
  indirizzo_riga_1: string;
  indirizzo_riga_2: string;
  numero_civico: string;
  comune: string;
  provincia: string;
  cap: string;
} {
  return {
    indirizzo_riga_1: getStr(row, "Indirizzo1"),
    indirizzo_riga_2: getStr(row, "Riga 2"),
    numero_civico: getStr(row, "Numero civico"),
    comune: getStr(row, "Comune"),
    provincia: getStr(row, "Provincia"),
    cap: getStr(row, "CAP"),
  };
}

/**
 * Normalizza una data in YYYY-MM-DD.
 * Accetta: Date, numero Excel (serial), "m/d/yy" (Excel US), "gg/mm/aaaa", "YYYY-MM-DD", stringa serial.
 * Per stringhe ambigue (entrambe le parti ≤ 12) preferisce m/d/y come in Excel US.
 */
export function parseDateToISO(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel/SheetJS spesso dà mezzanotte locale come sera UTC del giorno prima:
    // usa il calendario locale se l'ora UTC non è mezzanotte, altrimenti UTC.
    const useLocal = value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0;
    const yyyy = useLocal ? value.getFullYear() : value.getUTCFullYear();
    const mm = String((useLocal ? value.getMonth() : value.getUTCMonth()) + 1).padStart(2, "0");
    const dd = String(useLocal ? value.getDate() : value.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof value === "number") {
    // Solo la parte intera = giorno Excel (eventuale frazione oraria ignorata per date-only)
    const serial = Math.floor(value);
    if (serial < 1) return "";
    const millis = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(millis);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(value).trim();
  if (!s) return "";
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n >= 1) return parseDateToISO(n);
  }
  // ISO con eventuale orario (es. da JSON Date)
  const isoFull = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoFull) return `${isoFull[1]}-${isoFull[2]}-${isoFull[3]}`;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const a = parseInt(slash[1]!, 10);
    const b = parseInt(slash[2]!, 10);
    const y = slash[3]!;
    const year = y.length === 2 ? `20${y}` : y;
    let month: number;
    let day: number;
    if (a > 12 && b <= 12) {
      // chiaro: d/m/y (IT)
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      // chiaro: m/d/y (US / Excel)
      month = a;
      day = b;
    } else {
      // ambiguo (es. 1/2/24): Excel US → m/d/y
      month = a;
      day = b;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }
  return "";
}

/** @deprecated Usare parseDateToISO per avere sempre YYYY-MM-DD. */
export function formatExcelDate(value: unknown): string {
  return parseDateToISO(value);
}

export function formatExcelTime(value: unknown): string {
  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (typeof value === "string") return value.trim();
  return "";
}

export function splitNomeCognome(
  nomeCognome: string,
  cognomeSeparato?: string
): { nome: string; cognome: string } {
  if (!nomeCognome) return { nome: "", cognome: cognomeSeparato || "" };
  if (cognomeSeparato && nomeCognome.endsWith(cognomeSeparato)) {
    return { nome: nomeCognome.replace(cognomeSeparato, "").trim(), cognome: cognomeSeparato };
  }
  const lastSpace = nomeCognome.lastIndexOf(" ");
  if (lastSpace <= 0) return { nome: nomeCognome, cognome: cognomeSeparato || "" };
  return {
    nome: nomeCognome.slice(0, lastSpace).trim(),
    cognome: nomeCognome.slice(lastSpace).trim() || cognomeSeparato || "",
  };
}

function capitalize(s: string | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Prima lettera maiuscola, resto minuscolo (es. MONZA → Monza). */
function capitalizeFirstRestLower(s: string | undefined): string {
  if (!s) return "";
  const t = s.trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export interface ImportRow {
  index: number;
  /** true = formato Check Mediazioni (aggiornamento), false = Tracciato Organismo */
  sourceFormat?: "check" | "tracciato";
  mediazionePayload: {
    rgm: string;
    oggetto: string;
    valore: string;
    competenza: string;
    modalita_mediazione: string;
    motivazione_deposito: string;
    modalita_convocazione: string;
    nota: string;
    data_deposito: string | null;
    data_protocollo: string | null;
    /** Data chiusura (YYYY-MM-DD) — foglio Check */
    data_chiusura: string | null;
    /** Se true, scrive data_chiusura anche se null (Excel vuoto = clear) */
    data_chiusura_set?: boolean;
    /** Esito finale normalizzato — foglio Check */
    esito_finale: string;
    /** Se true, scrive esito_finale anche se vuoto (Excel vuoto = clear) */
    esito_finale_set?: boolean;
    /** Trasmissione al ministero — foglio Trasmessi / colonna Trasmissione */
    trasmessa?: boolean;
    /** Se true, aggiorna il flag trasmessa (anche a false) */
    trasmessa_set?: boolean;
    mediatore: string;
    /** Link istanza (Richiesta di Mediazione) - transition phase */
    link_istanza: string;
    /** Link cartella - transition phase */
    link_cartella: string;
    /** Link adesione chiamato — foglio Check */
    link_adesione: string;
    /** Link documento chiusura / verbale — foglio Check */
    link_documento_chiusura: string;
    /** Data incontro (YYYY-MM-DD) per creare record incontro */
    data_incontro: string;
    /** Ora incontro (HH:MM) per creare record incontro */
    ora_incontro: string;
  };
  parteIstante: {
    tipo: "Fisica";
    nome: string;
    cognome: string;
    codice_fiscale: string;
    indirizzo_riga_1?: string;
  };
  avvocatoIstante: {
    nome: string;
    cognome: string;
    codice_fiscale?: string;
    pec?: string;
    telefono?: string;
    indirizzo?: string;
  };
  parteChiamato: {
    tipo: "Fisica";
    nome: string;
    cognome: string;
    codice_fiscale: string;
    indirizzo_riga_1: string;
    indirizzo_riga_2: string;
    numero_civico: string;
    comune: string;
    provincia: string;
    cap: string;
  };
}

/** Prima voce di una lista "Nome1,Nome2". */
function firstPerson(raw: string): string {
  return raw.split(",")[0]?.trim() || "";
}

function looksLikeCheckFormat(row: Record<string, unknown>): boolean {
  return (
    "Data iscrizione" in row ||
    "Esito" in row ||
    "Link adesione" in row ||
    "Link documento chiusura" in row ||
    "Istante" in row
  );
}

function emptyParteChiamato() {
  return {
    tipo: "Fisica" as const,
    nome: "",
    cognome: "",
    codice_fiscale: "",
    indirizzo_riga_1: "",
    indirizzo_riga_2: "",
    numero_civico: "",
    comune: "",
    provincia: "",
    cap: "",
  };
}

/** Esiti dal foglio Check → valori canonici (o "" se aperto/legacy). */
export function normalizeCheckEsito(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (key === "aperta" || key === "non consegnabile" || key === "esito gestionale") return "";
  if (key === "nr" || key === "nessuna risposta" || key === "mancata comparizione") {
    return "Nessuna risposta";
  }
  if (key === "accordo") return "Accordo";
  if (key === "mancato accordo") return "Mancato accordo";
  if (key === "chiusa d'ufficio" || key === "chiusa d ufficio") return "Chiusa d'ufficio";
  if (key === "ritirata") return "Ritirata";
  if (key === "nessuna adesione" || key === "mancata adesione") return "Nessuna adesione";
  // Capitalizza prima lettera per match soft
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Colonna Trasmissione (SI/NO) → boolean; stringa vuota = non impostare. */
export function parseTrasmissioneFlag(raw: string): boolean | undefined {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!key) return undefined;
  if (key === "si" || key === "sì" || key === "yes" || key === "true" || key === "1") return true;
  if (key === "no" || key === "false" || key === "0") return false;
  return undefined;
}

/**
 * Mappa workbook Check Mediazioni (fogli Mediazioni + Trasmessi) oppure
 * Tracciato Organismo (singolo foglio / jsonRows).
 */
export function mapExcelWorkbookToImport(opts: {
  mediazioniRows: Record<string, unknown>[];
  /** Se presente (anche vuoto), aggiorna il boolean trasmessa da membership nel foglio. */
  trasmessiRows?: Record<string, unknown>[] | null;
}): ImportRow[] {
  const { mediazioniRows, trasmessiRows } = opts;
  const sample = mediazioniRows[0];
  if (sample && looksLikeCheckFormat(sample)) {
    const trasmessiSheetPresent = Array.isArray(trasmessiRows);
    const trasmessiSet = new Set<string>();
    if (trasmessiSheetPresent) {
      for (const row of trasmessiRows!) {
        const rgm = getStr(row, "RGM");
        const salvataggio = getStr(row, "Salvataggio").toUpperCase();
        if (rgm && (!salvataggio || salvataggio === "DEFINITIVO")) {
          trasmessiSet.add(rgm);
        }
      }
    }
    return mapCheckRowsToImport(mediazioniRows, trasmessiSet, trasmessiSheetPresent);
  }
  return mapExcelRowsToImport(mediazioniRows);
}

function mapCheckRowsToImport(
  jsonRows: Record<string, unknown>[],
  trasmessiSet: Set<string>,
  trasmessiSheetPresent: boolean
): ImportRow[] {
  return jsonRows
    .map((row, i) => {
      const rgm = getStr(row, "RGM");
      if (!rgm || rgm.toLowerCase() === "rgm") {
        return null;
      }
      const dataDeposito = parseDateToISO(
        row["Data iscrizione"] ?? getStr(row, "Data iscrizione")
      );
      const dataChiusura = parseDateToISO(
        row["Data chiusura"] ?? getStr(row, "Data chiusura")
      );
      const esito_finale = normalizeCheckEsito(getStr(row, "Esito"));
      const rawDataIncontro =
        row["Data incontro"] ?? getStr(row, "Data incontro") ?? "";
      const dataIncontro = parseDateToISO(rawDataIncontro);
      const rawOraIncontro = row["Ora incontro"] ?? getStr(row, "Ora incontro") ?? "";
      const oraIncontro = formatExcelTime(rawOraIncontro);

      const istanteFull = firstPerson(getStr(row, "Istante"));
      const { nome: nomeIstante, cognome: cognomeIstante } = splitNomeCognome(istanteFull);

      const chiamatoFull = firstPerson(getStr(row, "Chiamato"));
      const { nome: nomeChiamato, cognome: cognomeChiamato } = splitNomeCognome(chiamatoFull);

      const avvFull = firstPerson(
        getStr(row, "Avvocato istante") ||
          getStr(row, "Avvocati") ||
          getStr(row, "Avvocato")
      );
      const { nome: nomeAvv, cognome: cognomeAvv } = splitNomeCognome(avvFull);

      // Trasmissione: colonna SI/NO ha priorità; altrimenti foglio Trasmessi
      const trasCol = parseTrasmissioneFlag(getStr(row, "Trasmissione"));
      const trasmessa =
        trasCol !== undefined
          ? trasCol
          : trasmessiSheetPresent
            ? trasmessiSet.has(rgm)
            : undefined;
      const trasmessa_set = trasCol !== undefined || trasmessiSheetPresent;

      const mediazionePayload = {
        rgm,
        oggetto:
          getStr(row, "Oggetto / Materia") ||
          capitalize(getStr(row, "Materia")),
        valore: getStr(row, "Valore").trim(),
        competenza: capitalizeFirstRestLower(getStr(row, "Competenza").trim()),
        modalita_mediazione: capitalize(getStr(row, "Modalità").trim()),
        motivazione_deposito:
          capitalize(getStr(row, "Motivazione deposito").trim()) ||
          capitalize(getStr(row, "Motivo").trim()),
        modalita_convocazione: capitalize(getStr(row, "Modalità convocazione").trim()),
        nota: getStr(row, "Note") || getStr(row, "Nota"),
        data_deposito: dataDeposito || null,
        data_protocollo: null as string | null,
        // Excel = fonte: esito vuoto ⇒ mediazione aperta (clear chiusura)
        data_chiusura: esito_finale ? dataChiusura || null : null,
        data_chiusura_set: true,
        esito_finale,
        esito_finale_set: true,
        trasmessa,
        trasmessa_set,
        mediatore: getStr(row, "Mediatore"),
        link_istanza: getStr(row, "Link istanza") || getStr(row, "Link Istanza"),
        link_cartella: getStr(row, "Link Cartella") || getStr(row, "Link cartella"),
        link_adesione: getStr(row, "Link adesione"),
        link_documento_chiusura: getStr(row, "Link documento chiusura"),
        data_incontro: dataIncontro,
        ora_incontro: oraIncontro,
      };

      return {
        index: i + 1,
        sourceFormat: "check" as const,
        mediazionePayload,
        parteIstante: {
          tipo: "Fisica" as const,
          nome: nomeIstante || istanteFull,
          cognome: cognomeIstante,
          codice_fiscale: getStr(row, "CF Istante"),
        },
        avvocatoIstante: {
          nome: nomeAvv || avvFull,
          cognome: cognomeAvv,
        },
        parteChiamato: {
          ...emptyParteChiamato(),
          nome: nomeChiamato || chiamatoFull,
          cognome: cognomeChiamato,
          codice_fiscale: getStr(row, "CF Chiamato"),
        },
      };
    })
    .filter((r): r is ImportRow => {
      if (!r) return false;
      return Boolean(
        r.mediazionePayload.rgm ||
          r.mediazionePayload.mediatore ||
          r.parteIstante.nome ||
          r.parteChiamato.nome
      );
    });
}

export function mapExcelRowsToImport(jsonRows: Record<string, unknown>[]): ImportRow[] {
  return jsonRows
    .map((row, i) => {
      const dataDeposito = parseDateToISO(
        row["Data deposito"] ?? getStr(row, "Data deposito")
      );
      const dataProtocollo = parseDateToISO(
        row["Data protocollo"] ?? getStr(row, "Data protocollo")
      );
      const rgm = getStr(row, "RGM") || getStr(row, "Registro num.");
      const rawDataIncontro = row["Data incontro"] ?? getStr(row, "Data incontro") ?? "";
      const dataIncontro = parseDateToISO(rawDataIncontro);
      const rawOraIncontro = row["Ora incontro"] ?? getStr(row, "Ora incontro") ?? "";
      const oraIncontro = formatExcelTime(rawOraIncontro);

      const mediazionePayload = {
        rgm: rgm || getStr(row, "Registro num."),
        oggetto: capitalize(getStr(row, "Materia")),
        valore: getStr(row, "Valore").trim(),
        competenza: capitalizeFirstRestLower(getStr(row, "Competenza").trim()),
        modalita_mediazione: capitalize(getStr(row, "Modalità").trim()),
        motivazione_deposito:
          capitalize(getStr(row, "Motivazione deposito").trim()) ||
          capitalize(getStr(row, "Motivo").trim()),
        modalita_convocazione: capitalize(getStr(row, "Modalità convocazione").trim()),
        nota: "",
        data_deposito: dataDeposito || null,
        data_protocollo: dataProtocollo || null,
        data_chiusura: null as string | null,
        esito_finale: "",
        mediatore: getStr(row, "Mediatore"),
        link_istanza: getStr(row, "Link Istanza"),
        link_cartella: getStr(row, "Link Cartella"),
        link_adesione: "",
        link_documento_chiusura: "",
        data_incontro: dataIncontro,
        ora_incontro: oraIncontro,
      };

      const nomeCognomeIstante = getStr(row, "Nome e cognome Istante");
      const cognomeIstante = getStr(row, "Cognome Istante");
      const { nome: nomeIstante, cognome: cognomeIstanteFinal } = splitNomeCognome(
        nomeCognomeIstante,
        cognomeIstante
      );

      const parteIstante = {
        tipo: "Fisica" as const,
        nome: nomeIstante || nomeCognomeIstante,
        cognome: cognomeIstanteFinal,
        codice_fiscale: getStr(row, "CF Istante"),
      };

      const nomeCognomeAvv = getStr(row, "Nome e cognome Avv");
      const { nome: nomeAvv, cognome: cognomeAvv } = splitNomeCognome(nomeCognomeAvv);
      const avvocatoIstante = {
        nome: nomeAvv || nomeCognomeAvv,
        cognome: cognomeAvv,
        codice_fiscale: getStr(row, "CF Avvocato") || undefined,
        pec: getStr(row, "PEC Avv") || undefined,
        telefono: getStr(row, "Recapito Telefonico Avv.") || undefined,
        indirizzo: getStr(row, "Indirizzo avvocato") || undefined,
      };

      const addr = getIndirizzoChiamato(row);
      const parteChiamato = {
        tipo: "Fisica" as const,
        nome: getStr(row, "Nome Chiamato"),
        cognome: getStr(row, "Cognome Chiamato"),
        codice_fiscale: getStr(row, "CF Chiamato"),
        indirizzo_riga_1: addr.indirizzo_riga_1,
        indirizzo_riga_2: addr.indirizzo_riga_2,
        numero_civico: addr.numero_civico,
        comune: addr.comune,
        provincia: addr.provincia,
        cap: addr.cap,
      };

      return {
        index: i + 1,
        sourceFormat: "tracciato" as const,
        mediazionePayload,
        parteIstante,
        avvocatoIstante,
        parteChiamato,
      };
    })
    .filter(
      (r) =>
        r.mediazionePayload.rgm ||
        r.mediazionePayload.mediatore ||
        r.mediazionePayload.oggetto ||
        r.parteIstante.nome ||
        r.parteChiamato.nome
    );
}
