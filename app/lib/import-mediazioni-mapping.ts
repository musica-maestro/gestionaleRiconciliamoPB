/**
 * Client-safe Excel row mapping for mediazioni import (Tracciato Organismo).
 * Used by the import page for preview; server uses this + importRows for actual import.
 */
export function getStr(row: Record<string, unknown>, header: string): string {
  const v = row[header];
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

export function buildIndirizzo(row: Record<string, unknown>): string {
  const parts = [
    getStr(row, "Indirizzo1"),
    getStr(row, "Riga 2"),
    getStr(row, "Numero civico"),
    getStr(row, "Comune"),
    getStr(row, "Provincia"),
    getStr(row, "CAP"),
  ].filter(Boolean);
  return parts.join(", ");
}

export function formatExcelDate(value: unknown): string {
  if (typeof value === "number") {
    const millis = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(millis);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof value === "string") return value.trim();
  return "";
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
  };
}

export function mapExcelRowsToImport(jsonRows: Record<string, unknown>[]): ImportRow[] {
  return jsonRows
    .map((row, i) => {
      const notaParts: string[] = [];
      const dataDeposito = formatExcelDate(row["Data deposito"]);
      if (dataDeposito) notaParts.push(`Data deposito: ${dataDeposito}`);
      const registroNum = getStr(row, "Registro num.");
      const rgm = getStr(row, "RGM") || getStr(row, "Registro num.");
      if (registroNum && rgm !== registroNum) notaParts.push(`Registro: ${registroNum}`);
      const dataIncontro = formatExcelDate(row["Data incontro"]);
      if (dataIncontro) notaParts.push(`Data incontro: ${dataIncontro}`);
      const oraIncontro = formatExcelTime(row["Ora incontro"]);
      if (oraIncontro) notaParts.push(`Ora incontro: ${oraIncontro}`);

      const mediazionePayload = {
        rgm: rgm || getStr(row, "Registro num."),
        oggetto: capitalize(getStr(row, "Materia")),
        valore: getStr(row, "Valore").trim(),
        competenza: getStr(row, "Competenza").trim(),
        modalita_mediazione: capitalize(getStr(row, "Modalità").trim()),
        motivazione_deposito: capitalize(getStr(row, "Motivazione deposito").trim()),
        modalita_convocazione: capitalize(getStr(row, "Modalità convocazione").trim()),
        nota: notaParts.join(" | "),
        data_protocollo: dataDeposito || null,
        mediatore: getStr(row, "Mediatore"),
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

      const indirizzoChiamato = buildIndirizzo(row);
      const parteChiamato = {
        tipo: "Fisica" as const,
        nome: getStr(row, "Nome Chiamato"),
        cognome: getStr(row, "Cognome Chiamato"),
        codice_fiscale: getStr(row, "CF Chiamato"),
        indirizzo_riga_1: indirizzoChiamato,
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
