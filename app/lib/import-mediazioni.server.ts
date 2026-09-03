/**
 * Server-side logic for importing mediazioni from Excel (Tracciato Organismo format).
 * Parses rows and creates mediazioni, soggetti, avvocati, partecipazioni in PocketBase.
 */
import type PocketBase from "pocketbase";
import { parseDateToISO } from "~/lib/import-mediazioni-mapping";
import type { ImportRow } from "~/lib/import-mediazioni-mapping";

export type { ImportRow } from "~/lib/import-mediazioni-mapping";

export const IMPORT_ROW_HEADERS = [
  "RGM",
  "Registro num.",
  "Mediatore",
  "Materia",
  "Valore",
  "Competenza",
  "Modalità",
  "Data deposito",
  "Data incontro",
  "Ora incontro",
  "Nome e cognome Istante",
  "Cognome Istante",
  "CF Istante",
  "Nome e cognome Avv",
  "CF Avvocato",
  "PEC Avv",
  "Recapito Telefonico Avv.",
  "Indirizzo avvocato",
  "Nome Chiamato",
  "Cognome Chiamato",
  "CF Chiamato",
  "Indirizzo1",
  "Riga 2",
  "Numero civico",
  "Comune",
  "Provincia",
  "CAP",
  "Link Istanza",
  "Link Cartella",
];

function buildSoggettoIndirizzo(indirizzo: string): {
  indirizzo_riga_1?: string;
  indirizzo_riga_2?: string;
  numero_civico?: string;
  comune?: string;
  provincia?: string;
  cap?: string;
} {
  if (!indirizzo) return {};
  const parts = indirizzo.split(",").map((p) => p.trim());
  return {
    indirizzo_riga_1: parts[0] || undefined,
    indirizzo_riga_2: parts[1] || undefined,
    numero_civico: parts[2] || undefined,
    comune: parts[3] || undefined,
    provincia: parts[4] || undefined,
    cap: parts[5] || undefined,
  };
}

function isUrlLike(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && (t.startsWith("http://") || t.startsWith("https://"));
}

/** Build data_programmazione UTC from date (qualsiasi formato supportato da parseDateToISO) e ora (HH:MM o H.MM) in Europe/Rome. */
function buildDataProgrammazioneUTC(dateStr: string, timeStr: string): string | undefined {
  const dateNorm = parseDateToISO(dateStr);
  if (!dateNorm || !timeStr?.trim()) return undefined;
  const [y, mo, d] = dateNorm.split("-").map(Number);
  const timeNorm = timeStr.trim().replace(".", ":");
  const [h, mi] = timeNorm.split(":").map(Number);
  if (isNaN(y) || isNaN(mo) || isNaN(d) || isNaN(h) || isNaN(mi)) return undefined;
  const approxEpoch = Date.UTC(y, mo - 1, d, h, mi, 0);
  const epochFromParts = (epoch: number, tz: string): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(new Date(epoch));
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");
    const fh = get("hour");
    return Date.UTC(get("year"), get("month") - 1, get("day"), fh >= 24 ? 0 : fh, get("minute"), get("second"));
  };
  const offsetMs = epochFromParts(approxEpoch, "Europe/Rome") - epochFromParts(approxEpoch, "UTC");
  return new Date(approxEpoch - offsetMs).toISOString().replace("T", " ").slice(0, 19) + ".000Z";
}

type AddrFields = {
  indirizzo_riga_1?: string;
  indirizzo_riga_2?: string;
  numero_civico?: string;
  comune?: string;
  provincia?: string;
  cap?: string;
};

/** Find soggetto by CF, P.IVA, ragione sociale, or nome+cognome. Avoid clones. */
async function findOrCreateSoggetto(
  pb: PocketBase,
  parte: { nome: string; cognome: string; codice_fiscale: string },
  addrFields: AddrFields,
  opts?: { preferGiuridica?: boolean; fullName?: string }
): Promise<string> {
  const cfRaw = (parte.codice_fiscale || "").trim().toUpperCase().replace(/\s+/g, "");
  const junk = /^(N\.?D\.?|NA|N\/A|\?+|X+|-+)$/i.test(cfRaw);
  const cf = !junk && (cfRaw.length === 16 || cfRaw.length === 11) ? cfRaw : "";
  const full = (opts?.fullName || [parte.nome, parte.cognome].filter(Boolean).join(" ")).trim();
  const giuridicaHint = /\b(s\.?\s?r\.?\s?l\.?|s\.?\s?p\.?\s?a\.?|srl|spa|snc|sas|societ)/i.test(full);
  const giuridica = Boolean(opts?.preferGiuridica || giuridicaHint);

  if (cf) {
    const existing = await pb
      .collection("soggetti")
      .getFullList({
        filter: pb.filter("codice_fiscale = {:cf}", { cf }),
        limit: 1,
        fields: "id,nome,cognome,codice_fiscale,ragione_sociale,indirizzo_riga_1,indirizzo_riga_2,numero_civico,comune,provincia,cap",
      })
      .catch(() => []);
    if (existing.length > 0) {
      return patchSoggetto(pb, existing[0] as Record<string, unknown>, parte, addrFields);
    }
  }

  if (giuridica && full) {
    const existingRs = await pb
      .collection("soggetti")
      .getFullList({
        filter: pb.filter("ragione_sociale = {:rs}", { rs: full }),
        limit: 1,
        fields: "id,nome,cognome,codice_fiscale,ragione_sociale,indirizzo_riga_1,indirizzo_riga_2,numero_civico,comune,provincia,cap",
      })
      .catch(() => []);
    if (existingRs.length > 0) {
      return patchSoggetto(pb, existingRs[0] as Record<string, unknown>, parte, addrFields);
    }
  }

  const nome = (parte.nome || "").trim();
  const cognome = (parte.cognome || "").trim();
  if (nome && cognome) {
    const existingName = await pb
      .collection("soggetti")
      .getFullList({
        filter: pb.filter("nome = {:n} && cognome = {:c}", { n: nome, c: cognome }),
        limit: 1,
        fields: "id,nome,cognome,codice_fiscale,ragione_sociale,indirizzo_riga_1,indirizzo_riga_2,numero_civico,comune,provincia,cap",
      })
      .catch(() => []);
    if (existingName.length > 0) {
      return patchSoggetto(pb, existingName[0] as Record<string, unknown>, parte, addrFields);
    }
  }

  const payload: Record<string, unknown> = {
    ...addrFields,
  };
  if (giuridica) {
    payload.tipo = "Giuridica";
    payload.ragione_sociale = full || undefined;
    if (cf.length === 11) payload.piva = cf;
  } else {
    payload.tipo = "Fisica";
    payload.nome = parte.nome || undefined;
    payload.cognome = parte.cognome || undefined;
  }
  if (cf) payload.codice_fiscale = cf;
  const created = await pb.collection("soggetti").create(payload);
  return created.id;
}

async function patchSoggetto(
  pb: PocketBase,
  s: Record<string, unknown>,
  parte: { nome: string; cognome: string; codice_fiscale: string },
  addrFields: AddrFields
): Promise<string> {
  const id = s.id as string;
  const updates: Record<string, unknown> = {};
  if (!(s.nome as string)?.trim() && parte.nome) updates.nome = parte.nome;
  if (!(s.cognome as string)?.trim() && parte.cognome) updates.cognome = parte.cognome;
  if (!(s.indirizzo_riga_1 as string)?.trim() && addrFields.indirizzo_riga_1) updates.indirizzo_riga_1 = addrFields.indirizzo_riga_1;
  if (!(s.indirizzo_riga_2 as string)?.trim() && addrFields.indirizzo_riga_2) updates.indirizzo_riga_2 = addrFields.indirizzo_riga_2;
  if (!(s.numero_civico as string)?.trim() && addrFields.numero_civico) updates.numero_civico = addrFields.numero_civico;
  if (!(s.comune as string)?.trim() && addrFields.comune) updates.comune = addrFields.comune;
  if (!(s.provincia as string)?.trim() && addrFields.provincia) updates.provincia = addrFields.provincia;
  if (!(s.cap as string)?.trim() && addrFields.cap) updates.cap = addrFields.cap;
  if (Object.keys(updates).length > 0) {
    await pb.collection("soggetti").update(id, updates);
  }
  return id;
}

export async function importRows(
  pb: PocketBase,
  rows: ImportRow[],
  _userId: string,
  userNameToId: Record<string, string>
): Promise<{ success: number; errors: { index: number; error: string }[] }> {
  const errors: { index: number; error: string }[] = [];
  let success = 0;

  const tipiList = await pb.collection("documenti_tipi").getFullList({ fields: "id,nome" }).catch(() => []);
  const tipoByName: Record<string, string> = {};
  for (const t of tipiList as { id: string; nome: string }[]) {
    if (t.nome) tipoByName[t.nome] = t.id;
  }
  const tipoCartella = tipoByName["Cartella"];
  const tipoRichiesta = tipoByName["Richiesta di Mediazione"];

  for (const row of rows) {
    try {
      // Only set mediatore when Excel has a resolvable name — never default to importer.
      const mediatoreId =
        row.mediazionePayload.mediatore && userNameToId[row.mediazionePayload.mediatore]
          ? userNameToId[row.mediazionePayload.mediatore]
          : undefined;
      const stato = mediatoreId ? "assegnata" : "registrata";

      const mediazioneData: Record<string, unknown> = {
        rgm: row.mediazionePayload.rgm || undefined,
        oggetto: row.mediazionePayload.oggetto || undefined,
        valore: row.mediazionePayload.valore || undefined,
        competenza: row.mediazionePayload.competenza || undefined,
        modalita_mediazione: row.mediazionePayload.modalita_mediazione || undefined,
        motivazione_deposito: row.mediazionePayload.motivazione_deposito || undefined,
        modalita_convocazione: row.mediazionePayload.modalita_convocazione || undefined,
        nota: row.mediazionePayload.nota || undefined,
        data_deposito: row.mediazionePayload.data_deposito || undefined,
        data_protocollo: row.mediazionePayload.data_protocollo || undefined,
        stato,
        ...(mediatoreId ? { mediatore: mediatoreId } : { mediatore: "" }),
      };

      let mediazioneId!: string;
      let isUpdate = false;
      if (row.mediazionePayload.rgm) {
        const existing = await pb
          .collection("mediazioni")
          .getFullList({
            filter: pb.filter("rgm = {:rgm}", { rgm: row.mediazionePayload.rgm }),
            limit: 1,
          })
          .catch(() => []);
        if (existing.length > 0) {
          await pb.collection("mediazioni").update((existing[0] as { id: string }).id, mediazioneData);
          mediazioneId = (existing[0] as { id: string }).id;
          isUpdate = true;
        }
      }
      if (!isUpdate) {
        const created = await pb.collection("mediazioni").create(mediazioneData);
        mediazioneId = created.id;

        const soggettoIstanteId = await findOrCreateSoggetto(pb, row.parteIstante, {});

        let avvocatoId: string | undefined;
        const hasAvvocato =
          row.avvocatoIstante.nome || row.avvocatoIstante.cognome || row.avvocatoIstante.codice_fiscale;
        if (hasAvvocato) {
          const avv = await pb.collection("avvocati").create({
            nome: row.avvocatoIstante.nome || undefined,
            cognome: row.avvocatoIstante.cognome || undefined,
            codice_fiscale: row.avvocatoIstante.codice_fiscale,
            pec: row.avvocatoIstante.pec,
            telefono: row.avvocatoIstante.telefono,
            foro_di_appartenenza: row.avvocatoIstante.foro_di_appartenenza,
          });
          avvocatoId = avv.id;
        }

        const addrChiamato: AddrFields = {
          indirizzo_riga_1: row.parteChiamato.indirizzo_riga_1 || undefined,
          indirizzo_riga_2: row.parteChiamato.indirizzo_riga_2 || undefined,
          numero_civico: row.parteChiamato.numero_civico || undefined,
          comune: row.parteChiamato.comune || undefined,
          provincia: row.parteChiamato.provincia || undefined,
          cap: row.parteChiamato.cap || undefined,
        };
        const soggettoChiamatoId = await findOrCreateSoggetto(pb, row.parteChiamato, addrChiamato);

        const existingIstante = await pb.collection("partecipazioni").getFullList({
          filter: `mediazione = "${mediazioneId}" && soggetto = "${soggettoIstanteId}" && istante_o_chiamato = "Istante"`,
          limit: 1,
        });
        if (existingIstante.length === 0) {
          await pb.collection("partecipazioni").create({
            mediazione: mediazioneId,
            soggetto: soggettoIstanteId,
            istante_o_chiamato: "Istante",
            avvocati: avvocatoId ? [avvocatoId] : undefined,
          });
        }

        const existingChiamato = await pb.collection("partecipazioni").getFullList({
          filter: `mediazione = "${mediazioneId}" && soggetto = "${soggettoChiamatoId}" && istante_o_chiamato = "Chiamato"`,
          limit: 1,
        });
        if (existingChiamato.length === 0) {
          await pb.collection("partecipazioni").create({
            mediazione: mediazioneId,
            soggetto: soggettoChiamatoId,
            istante_o_chiamato: "Chiamato",
          });
        }
      }

      // Documenti: upsert link istanza and cartella (find by mediazione+tipo, update or create)
      const linkIstanza = (row.mediazionePayload.link_istanza || "").trim();
      const linkCartella = (row.mediazionePayload.link_cartella || "").trim();
      if (tipoRichiesta && isUrlLike(linkIstanza)) {
        const existingIstanzaDoc = await pb
          .collection("documenti")
          .getFullList({
            filter: pb.filter("mediazione = {:m} && tipo = {:t}", { m: mediazioneId, t: tipoRichiesta }),
            limit: 1,
            fields: "id,link_legacy",
          })
          .catch(() => []);
        if (existingIstanzaDoc.length > 0) {
          const doc = existingIstanzaDoc[0] as { id: string; link_legacy?: string };
          if (doc.link_legacy !== linkIstanza) {
            await pb.collection("documenti").update(doc.id, { link_legacy: linkIstanza });
          }
        } else {
          await pb.collection("documenti").create({
            mediazione: mediazioneId,
            tipo: tipoRichiesta,
            descrizione: "Richiesta di mediazione (import)",
            link_legacy: linkIstanza,
          });
        }
      }
      if (tipoCartella && isUrlLike(linkCartella)) {
        const existingCartellaDoc = await pb
          .collection("documenti")
          .getFullList({
            filter: pb.filter("mediazione = {:m} && tipo = {:t}", { m: mediazioneId, t: tipoCartella }),
            limit: 1,
            fields: "id,link_legacy",
          })
          .catch(() => []);
        if (existingCartellaDoc.length > 0) {
          const doc = existingCartellaDoc[0] as { id: string; link_legacy?: string };
          if (doc.link_legacy !== linkCartella) {
            await pb.collection("documenti").update(doc.id, { link_legacy: linkCartella });
          }
        } else {
          await pb.collection("documenti").create({
            mediazione: mediazioneId,
            tipo: tipoCartella,
            descrizione: "Cartella (import)",
            link_legacy: linkCartella,
          });
        }
      }

      // Incontro: upsert — find the first incontro for this mediazione; update data_programmazione
      // if changed, create if none exists
      const dataIncontroRaw = (row.mediazionePayload.data_incontro ?? "").toString().trim();
      const oraIncontroRaw = (row.mediazionePayload.ora_incontro ?? "").toString().trim();
      const dataProg = buildDataProgrammazioneUTC(dataIncontroRaw, oraIncontroRaw);
      if (dataProg) {
        const existingIncontri = await pb
          .collection("incontri")
          .getFullList({
            filter: pb.filter("mediazione = {:m}", { m: mediazioneId }),
            limit: 1,
            fields: "id,data_programmazione",
          })
          .catch(() => []);
        if (existingIncontri.length > 0) {
          const inc = existingIncontri[0] as { id: string; data_programmazione?: string };
          if (inc.data_programmazione !== dataProg) {
            await pb.collection("incontri").update(inc.id, { data_programmazione: dataProg });
          }
        } else {
          await pb.collection("incontri").create({
            mediazione: mediazioneId,
            data_programmazione: dataProg,
            report: "",
          });
        }
      }

      success++;
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "Errore sconosciuto";
      errors.push({ index: row.index, error: msg });
    }
  }

  return { success, errors };
}
