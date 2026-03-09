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

/** Normalizza una data in YYYY-MM-DD. Accetta: numero Excel, "gg/mm/aaaa", "m/g/aa", "YYYY-MM-DD", stringa numerica (serial). */
export function parseDateToISO(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    const millis = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(millis);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(value).trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 25569) return parseDateToISO(n);
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return s;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let d = parseInt(slash[1], 10);
    let m = parseInt(slash[2], 10);
    const y = slash[3];
    const year = y!.length === 2 ? `20${y}` : y!;
    if (d > 12) {
    } else if (m > 12) {
      [d, m] = [m, d];
    }
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
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
  mediazionePayload: {
    rgm: string;
    oggetto: string;
    valore: string;
    competenza: string;
    modalita_mediazione: string;
    motivazione_deposito: string;
    modalita_convocazione: string;
    nota: string;
    data_protocollo: string | null;
    mediatore: string;
    /** Link istanza (Richiesta di Mediazione) - transition phase */
    link_istanza: string;
    /** Link cartella - transition phase */
    link_cartella: string;
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
    foro_di_appartenenza?: string;
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

export function mapExcelRowsToImport(jsonRows: Record<string, unknown>[]): ImportRow[] {
  return jsonRows
    .map((row, i) => {
      const dataDeposito = parseDateToISO(getStr(row, "Data deposito") || (row["Data deposito"] ?? ""));
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
        data_protocollo: dataDeposito || null,
        mediatore: getStr(row, "Mediatore"),
        link_istanza: getStr(row, "Link Istanza"),
        link_cartella: getStr(row, "Link Cartella"),
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
        foro_di_appartenenza: getStr(row, "Indirizzo avvocato") || undefined,
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
