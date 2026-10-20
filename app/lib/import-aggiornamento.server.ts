/**
 * Apply "Aggiornamento gestionale.xlsx" rows to PocketBase.
 */
import type PocketBase from "pocketbase";
import { splitEsitoRaccomandata } from "~/lib/esito-finale";
import { processAzioneRaccomandata } from "~/lib/raccomandate-azioni.server";
import {
  isCanonicalEsitoFinale,
  isCanonicalEsitoRaccomandata,
  type AggiornamentoIssue,
  type AggiornamentoRow,
} from "~/lib/import-aggiornamento-mapping";

export type { AggiornamentoIssue, AggiornamentoRow };
export {
  mapExcelRowsToAggiornamento,
  normalizeEsitoRaccomandata,
  parseExcelDate,
} from "~/lib/import-aggiornamento-mapping";

export type AggiornamentoApplyResult = {
  success: number;
  mediazioniUpdated: number;
  convocazioniUpdated: number;
  convocazioniCreated: number;
  skipped: number;
  errors: AggiornamentoIssue[];
  warnings: AggiornamentoIssue[];
};

async function findMediazioneByRgm(
  pb: PocketBase,
  rgm: string,
): Promise<{ id: string } | null | "ambiguous"> {
  const found = await pb
    .collection("mediazioni")
    .getFullList({
      filter: pb.filter("rgm = {:rgm} && (is_deleted = false || is_deleted = null)", { rgm }),
      fields: "id,rgm",
      requestKey: null,
    })
    .catch(() => []);
  if (found.length === 0) return null;
  if (found.length > 1) return "ambiguous";
  return { id: String(found[0]!.id) };
}

async function findChiamatoPartecipazioneId(
  pb: PocketBase,
  mediazioneId: string,
): Promise<string | null> {
  try {
    const list = await pb.collection("partecipazioni").getList(1, 1, {
      filter: `mediazione = "${mediazioneId}" && istante_o_chiamato = "Chiamato"`,
      sort: "id",
      fields: "id",
      requestKey: null,
    });
    return list.items[0]?.id ? String(list.items[0].id) : null;
  } catch {
    return null;
  }
}

async function findRaccomandataConvocazioneId(
  pb: PocketBase,
  mediazioneId: string,
): Promise<string | null> {
  const chiamati = await pb
    .collection("partecipazioni")
    .getFullList({
      filter: `mediazione = "${mediazioneId}" && istante_o_chiamato = "Chiamato"`,
      fields: "id",
      requestKey: null,
    })
    .catch(() => []);

  if (chiamati.length === 0) return null;

  const all: Array<{
    id: string;
    data_invio?: string;
    created?: string;
    stato_raccomandata?: string;
  }> = [];

  for (const p of chiamati) {
    const list = await pb
      .collection("convocazioni")
      .getFullList({
        filter: `partecipazione = "${p.id}" && tipologia = "Raccomandata"`,
        // Single-field sort: multi-field (-data_invio,-created) 500s on this PB.
        sort: "-data_invio",
        fields: "id,data_invio,created,stato_raccomandata",
        requestKey: null,
      })
      .catch(() => []);
    for (const c of list) {
      all.push({
        id: String(c.id),
        data_invio: c.data_invio ? String(c.data_invio) : undefined,
        created: c.created ? String(c.created) : undefined,
        stato_raccomandata: c.stato_raccomandata ? String(c.stato_raccomandata) : undefined,
      });
    }
  }

  if (all.length === 0) return null;

  const unsorted = [...all];
  unsorted.sort((a, b) => {
    const aOpen = a.stato_raccomandata ? 1 : 0;
    const bOpen = b.stato_raccomandata ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;
    const aKey = a.data_invio || a.created || "";
    const bKey = b.data_invio || b.created || "";
    return bKey.localeCompare(aKey);
  });
  return unsorted[0]?.id ?? null;
}

async function upsertRaccomandataConvocazione(
  pb: PocketBase,
  opts: {
    mediazioneId: string;
    stato_raccomandata: string;
    motivo_raccomandata: string;
    dryRun?: boolean;
  },
): Promise<"updated" | "created" | "no_chiamato"> {
  const existingId = await findRaccomandataConvocazioneId(pb, opts.mediazioneId);
  if (existingId) {
    if (!opts.dryRun) {
      await pb.collection("convocazioni").update(existingId, {
        stato_raccomandata: opts.stato_raccomandata || null,
        motivo_raccomandata: opts.motivo_raccomandata || null,
      });
    }
    return "updated";
  }

  const chiamatoId = await findChiamatoPartecipazioneId(pb, opts.mediazioneId);
  if (!chiamatoId) return "no_chiamato";

  if (!opts.dryRun) {
    // Contesto legacy: senza data_invio e senza numero raccomandata
    await pb.collection("convocazioni").create({
      partecipazione: chiamatoId,
      tipologia: "Raccomandata",
      stato_raccomandata: opts.stato_raccomandata || undefined,
      motivo_raccomandata: opts.motivo_raccomandata || undefined,
      nota: "Creata da aggiornamento raccomandate (senza match convocazione)",
    });
  }
  return "created";
}

export async function applyAggiornamentoRows(
  pb: PocketBase,
  rows: AggiornamentoRow[],
  opts?: { attoreId?: string; dryRun?: boolean },
): Promise<AggiornamentoApplyResult> {
  const dryRun = opts?.dryRun === true;
  const errors: AggiornamentoIssue[] = [];
  const warnings: AggiornamentoIssue[] = [];
  let mediazioniUpdated = 0;
  let convocazioniUpdated = 0;
  let convocazioniCreated = 0;
  let success = 0;
  let skipped = 0;
  const seenRgm = new Set<string>();

  for (const row of rows) {
    if (!row.rgm) {
      errors.push({ index: row.index, rgm: "", error: "RGM mancante" });
      skipped++;
      continue;
    }

    const rgmKey = row.rgm.toLowerCase();
    if (seenRgm.has(rgmKey)) {
      errors.push({ index: row.index, rgm: row.rgm, error: "RGM duplicato nel file" });
      skipped++;
      continue;
    }
    seenRgm.add(rgmKey);

    if (!row.esito_finale && !row.data_chiusura && !row.esito_raccomandata) {
      errors.push({
        index: row.index,
        rgm: row.rgm,
        error: "Nessun campo da aggiornare",
      });
      skipped++;
      continue;
    }

    if (row.esito_raccomandata && !isCanonicalEsitoRaccomandata(row.esito_raccomandata)) {
      errors.push({
        index: row.index,
        rgm: row.rgm,
        error: `Esito raccomandata non riconosciuto: ${row.esito_raccomandata}`,
      });
      skipped++;
      continue;
    }

    if (row.esito_finale && !isCanonicalEsitoFinale(row.esito_finale)) {
      errors.push({
        index: row.index,
        rgm: row.rgm,
        error: `Esito non riconosciuto: ${row.esito_finale}`,
      });
      skipped++;
      continue;
    }

    if (row.esito_finale || row.data_chiusura) {
      if (!row.esito_finale) {
        errors.push({
          index: row.index,
          rgm: row.rgm,
          error: "Esito mancante (richiesto con data chiusura)",
        });
        skipped++;
        continue;
      }
      if (!row.data_chiusura) {
        errors.push({
          index: row.index,
          rgm: row.rgm,
          error: "Data chiusura mancante o non valida",
        });
        skipped++;
        continue;
      }
    }

    const mediazione = await findMediazioneByRgm(pb, row.rgm);
    if (mediazione === null) {
      errors.push({ index: row.index, rgm: row.rgm, error: "RGM non trovato" });
      skipped++;
      continue;
    }
    if (mediazione === "ambiguous") {
      errors.push({ index: row.index, rgm: row.rgm, error: "RGM non univoco in archivio" });
      skipped++;
      continue;
    }

    try {
      if (row.esito_finale || row.data_chiusura) {
        if (!dryRun) {
          await pb.collection("mediazioni").update(mediazione.id, {
            ...(row.esito_finale ? { esito_finale: row.esito_finale } : {}),
            ...(row.data_chiusura ? { data_chiusura: row.data_chiusura } : {}),
          });
        }
        mediazioniUpdated++;
      }

      if (row.esito_raccomandata) {
        const { stato_raccomandata, motivo_raccomandata } = splitEsitoRaccomandata(
          row.esito_raccomandata,
        );
        const result = await upsertRaccomandataConvocazione(pb, {
          mediazioneId: mediazione.id,
          stato_raccomandata,
          motivo_raccomandata,
          dryRun,
        });

        if (result === "no_chiamato") {
          warnings.push({
            index: row.index,
            rgm: row.rgm,
            error:
              "Nessun chiamato sulla mediazione — aggiornati solo esito/data chiusura",
          });
        } else if (result === "created") {
          convocazioniCreated++;
          if (!dryRun) {
            await processAzioneRaccomandata({
              pb,
              mediazioneId: mediazione.id,
              statoRaccomandata: stato_raccomandata,
              motivoRaccomandata: motivo_raccomandata,
              attoreId: opts?.attoreId,
            });
          }
        } else {
          convocazioniUpdated++;
          if (!dryRun) {
            await processAzioneRaccomandata({
              pb,
              mediazioneId: mediazione.id,
              statoRaccomandata: stato_raccomandata,
              motivoRaccomandata: motivo_raccomandata,
              attoreId: opts?.attoreId,
            });
          }
        }
      }

      success++;
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Errore sconosciuto";
      errors.push({ index: row.index, rgm: row.rgm, error: msg });
      skipped++;
    }
  }

  return {
    success,
    mediazioniUpdated,
    convocazioniUpdated,
    convocazioniCreated,
    skipped,
    errors,
    warnings,
  };
}
