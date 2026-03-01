/**
 * Server-side logic for importing mediazioni from Excel (Tracciato Organismo format).
 * Parses rows and creates mediazioni, soggetti, avvocati, partecipazioni in PocketBase.
 */
import type PocketBase from "pocketbase";
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

export async function importRows(
  pb: PocketBase,
  rows: ImportRow[],
  userId: string,
  userNameToId: Record<string, string>
): Promise<{ success: number; errors: { index: number; error: string }[] }> {
  const errors: { index: number; error: string }[] = [];
  let success = 0;

  for (const row of rows) {
    try {
      const mediatoreId =
        row.mediazionePayload.mediatore && userNameToId[row.mediazionePayload.mediatore]
          ? userNameToId[row.mediazionePayload.mediatore]
          : userId;

      const mediazioneData: Record<string, unknown> = {
        rgm: row.mediazionePayload.rgm || undefined,
        oggetto: row.mediazionePayload.oggetto || undefined,
        valore: row.mediazionePayload.valore || undefined,
        competenza: row.mediazionePayload.competenza || undefined,
        modalita_mediazione: row.mediazionePayload.modalita_mediazione || undefined,
        motivazione_deposito: row.mediazionePayload.motivazione_deposito || undefined,
        modalita_convocazione: row.mediazionePayload.modalita_convocazione || undefined,
        nota: row.mediazionePayload.nota || undefined,
        data_protocollo: row.mediazionePayload.data_protocollo || undefined,
        mediatore: mediatoreId,
      };

      let mediazioneId: string;
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
        const soggettoIstante = await pb.collection("soggetti").create({
          tipo: "Fisica",
          nome: row.parteIstante.nome || undefined,
          cognome: row.parteIstante.cognome || undefined,
          codice_fiscale: row.parteIstante.codice_fiscale || undefined,
        });

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

        const addrChiamato = buildSoggettoIndirizzo(row.parteChiamato.indirizzo_riga_1);
        const soggettoChiamato = await pb.collection("soggetti").create({
          tipo: "Fisica",
          nome: row.parteChiamato.nome || undefined,
          cognome: row.parteChiamato.cognome || undefined,
          codice_fiscale: row.parteChiamato.codice_fiscale || undefined,
          ...addrChiamato,
        });

        const existingIstante = await pb.collection("partecipazioni").getFullList({
          filter: `mediazione = "${mediazioneId}" && soggetto = "${soggettoIstante.id}" && istante_o_chiamato = "Istante"`,
          limit: 1,
        });
        if (existingIstante.length === 0) {
          await pb.collection("partecipazioni").create({
            mediazione: mediazioneId,
            soggetto: soggettoIstante.id,
            istante_o_chiamato: "Istante",
            avvocati: avvocatoId ? [avvocatoId] : undefined,
          });
        }

        const existingChiamato = await pb.collection("partecipazioni").getFullList({
          filter: `mediazione = "${mediazioneId}" && soggetto = "${soggettoChiamato.id}" && istante_o_chiamato = "Chiamato"`,
          limit: 1,
        });
        if (existingChiamato.length === 0) {
          await pb.collection("partecipazioni").create({
            mediazione: mediazioneId,
            soggetto: soggettoChiamato.id,
            istante_o_chiamato: "Chiamato",
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
