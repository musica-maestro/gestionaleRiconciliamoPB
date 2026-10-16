/**
 * Mapping client-safe per Aggiornamento_gestionale.xlsx
 * Colonne: RGM | Esito raccomandata | Esito | Data chiusura
 */
import {
  ESITO_FINALE_VALUES,
  ESITO_RACCOMANDATA_VALUES,
  normalizeEsitoFinale,
  type EsitoRaccomandata,
} from "~/lib/esito-finale";

export type AggiornamentoRow = {
  index: number;
  rgm: string;
  esito_raccomandata: string;
  esito_finale: string;
  data_chiusura: string;
};

export type AggiornamentoIssue = {
  index: number;
  rgm: string;
  error: string;
};

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Excel serial / Date / string → YYYY-MM-DD (giorno di calendario, senza shift TZ). */
export function parseExcelDate(value: unknown): string {
  // SheetJS cellDates: mezzanotte locale → ISO UTC del giorno prima (es. 16/10 IT = 15/10 22:00Z).
  // Usare i componenti locali per recuperare il giorno Excel.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const dd = String(value.getDate()).padStart(2, "0");
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    return `${value.getFullYear()}-${mm}-${dd}`;
  }
  if (typeof value === "number") {
    // Serial Excel = giorno di calendario; epoch 1970-01-01 = 25569.
    const millis = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(millis);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{5,6}(?:\.\d+)?$/.test(raw)) {
    return parseExcelDate(Number(raw));
  }
  const match = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
  if (!match) return "";
  const dd = String(Number(match[1])).padStart(2, "0");
  const mm = String(Number(match[2])).padStart(2, "0");
  const yyyy = match[3]!;
  return `${yyyy}-${mm}-${dd}`;
}

/** Normalizza esito raccomandata Excel → valore canonico UI/DB. */
export function normalizeEsitoRaccomandata(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (key === "consegnato" || key === "consegnata") return "Consegnata";
  const exact = ESITO_RACCOMANDATA_VALUES.find((v) => v.toLowerCase() === key);
  if (exact) return exact;
  if (key.includes("compiuta giacenza")) return "Al mittente per compiuta giacenza";
  if (key.includes("invio rifiutato") || key === "rifiutato") return "Invio rifiutato";
  if (key.includes("irreperibile")) return "Destinatario irreperibile";
  if (key.includes("deceduto")) return "Destinatario deceduto";
  if (key.includes("sconosciuto")) return "Destinatario sconosciuto";
  if (key.includes("trasferito")) return "Destinatario trasferito";
  if (key.includes("inesatto")) return "Indirizzo inesatto";
  if (key.includes("inesistente")) return "Indirizzo inesistente";
  if (key.includes("insufficiente")) return "Indirizzo insufficiente";
  return trimmed;
}

export function isCanonicalEsitoRaccomandata(v: string): v is EsitoRaccomandata {
  return (ESITO_RACCOMANDATA_VALUES as readonly string[]).includes(v);
}

export function isCanonicalEsitoFinale(v: string): boolean {
  return (ESITO_FINALE_VALUES as readonly string[]).includes(v);
}

export function mapExcelRowsToAggiornamento(
  jsonRows: Record<string, unknown>[],
): AggiornamentoRow[] {
  return jsonRows
    .map((row, index) => {
      const values: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        values[normalizeHeader(key)] = value;
      }
      const esitoRaccRaw = String(values.esito_raccomandata ?? "").trim();
      return {
        index: index + 1,
        rgm: String(values.rgm ?? "").trim(),
        esito_raccomandata: normalizeEsitoRaccomandata(esitoRaccRaw),
        esito_finale: normalizeEsitoFinale(String(values.esito ?? values.esito_finale ?? "")),
        data_chiusura: parseExcelDate(values.data_chiusura),
      };
    })
    .filter(
      (r) => r.rgm || r.esito_raccomandata || r.esito_finale || r.data_chiusura,
    );
}
