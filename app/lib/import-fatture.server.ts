/**
 * Upsert import of fatture from Excel rows.
 * - Update when an existing fattura matches
 * - Create when mediazione + partecipazione match but no fattura does
 * - Skip ambiguous / missing RGM / missing parte
 */
import type PocketBase from "pocketbase";
import {
  normalizePersonKey,
  normalizeRgmKey,
  notaMatchesNumero,
  yearFromISO,
  type FatturaImportRow,
} from "~/lib/import-fatture-mapping";

export type FatturaImportError = { index: number; error: string; rgm?: string; cliente?: string };

export type FatturaImportResult = {
  success: number;
  updated: number;
  created: number;
  skipped: number;
  errors: FatturaImportError[];
};

type SoggettoLite = {
  id: string;
  nome?: string;
  cognome?: string;
  ragione_sociale?: string;
  tipo?: string;
};

type PartecipazioneLite = {
  id: string;
  mediazione: string;
  soggetto: string;
  expand?: { soggetto?: SoggettoLite };
};

type FatturaLite = {
  id: string;
  mediazione: string;
  partecipazione: string;
  numero_fattura?: string;
  data_emissione_fattura?: string;
  data_incasso?: string;
  imponibile?: number;
  nota?: string;
};

type MediazioneLite = { id: string; rgm?: string };

type Indexes = {
  mediazioneByRgm: Map<string, MediazioneLite>;
  partiByMediazione: Map<string, PartecipazioneLite[]>;
  fattureByParte: Map<string, FatturaLite[]>;
};

function dateKey(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function almostEqual(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.015;
}

function soggettoLabels(s: SoggettoLite | undefined): string[] {
  if (!s) return [];
  const labels: string[] = [];
  const rs = normalizePersonKey(s.ragione_sociale || "");
  if (rs) labels.push(rs);
  const cognome = normalizePersonKey(s.cognome || "");
  if (cognome) labels.push(cognome);
  const full = normalizePersonKey([s.nome, s.cognome].filter(Boolean).join(" "));
  if (full) labels.push(full);
  const reverse = normalizePersonKey([s.cognome, s.nome].filter(Boolean).join(" "));
  if (reverse && reverse !== full) labels.push(reverse);
  return labels;
}

function matchPartecipazione(
  parti: PartecipazioneLite[],
  cliente: string
): { ok: true; parte: PartecipazioneLite } | { ok: false; reason: string } {
  const key = normalizePersonKey(cliente);
  if (!key) return { ok: false, reason: "Cliente vuoto" };

  const exact: PartecipazioneLite[] = [];
  const partial: PartecipazioneLite[] = [];

  for (const p of parti) {
    const labels = soggettoLabels(p.expand?.soggetto);
    if (labels.some((l) => l === key)) {
      exact.push(p);
      continue;
    }
    if (
      labels.some(
        (l) =>
          l === key ||
          l.startsWith(key + " ") ||
          l.endsWith(" " + key) ||
          key.startsWith(l + " ") ||
          key.endsWith(" " + l) ||
          l.includes(key) ||
          key.includes(l)
      )
    ) {
      partial.push(p);
    }
  }

  if (exact.length === 1) return { ok: true, parte: exact[0]! };
  if (exact.length > 1) return { ok: false, reason: `Parte ambigua (exact): ${cliente}` };
  if (partial.length === 1) return { ok: true, parte: partial[0]! };
  if (partial.length > 1) return { ok: false, reason: `Parte ambigua: ${cliente}` };
  return { ok: false, reason: `Parte non trovata: ${cliente}` };
}

function matchFattura(
  fatture: FatturaLite[],
  row: FatturaImportRow
): { ok: true; fattura: FatturaLite } | { ok: false; reason: "not_found" | "ambiguous"; detail: string } {
  if (fatture.length === 0) {
    return { ok: false, reason: "not_found", detail: "Nessuna fattura esistente per la parte" };
  }

  const year = yearFromISO(row.data_emissione);
  const byNumero: FatturaLite[] = [];

  if (row.numero_fattura) {
    for (const f of fatture) {
      const num = String(f.numero_fattura ?? "").trim();
      if (num && num === row.numero_fattura) {
        byNumero.push(f);
        continue;
      }
      if (notaMatchesNumero(f.nota, row.numero_fattura, year)) {
        byNumero.push(f);
      }
    }
  }

  let candidates = byNumero;

  if (candidates.length === 0 && row.imponibile != null) {
    candidates = fatture.filter((f) => almostEqual(f.imponibile, row.imponibile));
    if (candidates.length > 1 && row.data_emissione) {
      const dated = candidates.filter((f) => dateKey(f.data_emissione_fattura) === row.data_emissione);
      if (dated.length > 0) candidates = dated;
    }
  } else if (candidates.length > 1 && row.imponibile != null) {
    const byImp = candidates.filter((f) => almostEqual(f.imponibile, row.imponibile));
    if (byImp.length > 0) candidates = byImp;
  }

  if (candidates.length === 0) {
    return { ok: false, reason: "not_found", detail: "Fattura esistente non trovata" };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      detail: `Fattura ambigua (${candidates.length} match)`,
    };
  }
  return { ok: true, fattura: candidates[0]! };
}

function buildNota(row: FatturaImportRow): string | undefined {
  if (row.descrizione) return row.descrizione;
  if (row.numero_fattura) {
    const year = yearFromISO(row.data_emissione);
    return year ? `Fatt. ${row.numero_fattura}/${year}` : `Fatt. ${row.numero_fattura}`;
  }
  return undefined;
}

function buildCreatePayload(
  mediazioneId: string,
  partecipazioneId: string,
  row: FatturaImportRow
): Record<string, unknown> | null {
  // Need at least an amount or a number to create a meaningful record
  if (row.imponibile == null && !row.numero_fattura && !row.data_emissione && !row.data_incasso) {
    return null;
  }
  return {
    mediazione: mediazioneId,
    partecipazione: partecipazioneId,
    numero_fattura: row.numero_fattura || undefined,
    data_emissione_fattura: row.data_emissione || null,
    data_incasso: row.data_incasso || null,
    imponibile: row.imponibile ?? undefined,
    nota: buildNota(row),
  };
}

function buildUpdatePayload(
  existing: FatturaLite,
  row: FatturaImportRow
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  if (row.numero_fattura) {
    const current = String(existing.numero_fattura ?? "").trim();
    if (!current || current !== row.numero_fattura) {
      patch.numero_fattura = row.numero_fattura;
    }
  }
  if (row.data_emissione) {
    if (dateKey(existing.data_emissione_fattura) !== row.data_emissione) {
      patch.data_emissione_fattura = row.data_emissione;
    }
  }
  if (row.data_incasso) {
    if (dateKey(existing.data_incasso) !== row.data_incasso) {
      patch.data_incasso = row.data_incasso;
    }
  }
  if (row.imponibile != null) {
    const cur = existing.imponibile;
    // Do not overwrite a different amount (Excel often splits lines that PB stores aggregated).
    if (cur == null || cur === 0) {
      patch.imponibile = row.imponibile;
    }
  }
  if (row.descrizione) {
    const nota = String(existing.nota ?? "").trim();
    if (!nota) {
      patch.nota = row.descrizione;
    } else if (!nota.toLowerCase().includes(row.descrizione.toLowerCase())) {
      patch.nota = `${nota}\n${row.descrizione}`;
    }
  }
  if (row.numero_fattura && row.data_emissione) {
    const year = yearFromISO(row.data_emissione);
    const sug = year ? `Fatt. ${row.numero_fattura}/${year}` : `Fatt. ${row.numero_fattura}`;
    const nota = String((patch.nota as string | undefined) ?? existing.nota ?? "").trim();
    if (!nota) patch.nota = sug;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/** Reuse indexes across batch POSTs in the same import (dev/server process). */
let indexesCache: { at: number; indexes: Indexes } | null = null;
const INDEXES_TTL_MS = 3 * 60 * 1000;

export async function buildFattureImportIndexes(
  pb: PocketBase,
  opts: { force?: boolean } = {}
): Promise<Indexes> {
  if (
    !opts.force &&
    indexesCache &&
    Date.now() - indexesCache.at < INDEXES_TTL_MS
  ) {
    return indexesCache.indexes;
  }

  const [mediazioni, partecipazioni, fatture] = await Promise.all([
    pb.collection("mediazioni").getFullList({
      filter: "is_deleted != true",
      fields: "id,rgm",
    }) as Promise<MediazioneLite[]>,
    pb.collection("partecipazioni").getFullList({
      expand: "soggetto",
      fields: "id,mediazione,soggetto,expand.soggetto.id,expand.soggetto.nome,expand.soggetto.cognome,expand.soggetto.ragione_sociale,expand.soggetto.tipo",
    }) as Promise<PartecipazioneLite[]>,
    pb.collection("fatture").getFullList({
      fields: "id,mediazione,partecipazione,numero_fattura,data_emissione_fattura,data_incasso,imponibile,nota",
    }) as Promise<FatturaLite[]>,
  ]);

  const mediazioneByRgm = new Map<string, MediazioneLite>();
  for (const m of mediazioni) {
    if (!m.rgm) continue;
    const key = normalizeRgmKey(m.rgm);
    if (!mediazioneByRgm.has(key)) mediazioneByRgm.set(key, m);
  }

  const partiByMediazione = new Map<string, PartecipazioneLite[]>();
  for (const p of partecipazioni) {
    const list = partiByMediazione.get(p.mediazione) ?? [];
    list.push(p);
    partiByMediazione.set(p.mediazione, list);
  }

  const fattureByParte = new Map<string, FatturaLite[]>();
  for (const f of fatture) {
    const list = fattureByParte.get(f.partecipazione) ?? [];
    list.push(f);
    fattureByParte.set(f.partecipazione, list);
  }

  const indexes = { mediazioneByRgm, partiByMediazione, fattureByParte };
  indexesCache = { at: Date.now(), indexes };
  return indexes;
}

export function clearFattureImportIndexesCache() {
  indexesCache = null;
}

/**
 * Upsert import. If `dryRun` is true, no PocketBase writes are performed.
 */
export async function importFattureRows(
  pb: PocketBase,
  rows: FatturaImportRow[],
  opts: { dryRun?: boolean; indexes?: Indexes } = {}
): Promise<FatturaImportResult> {
  const indexes = opts.indexes ?? (await buildFattureImportIndexes(pb));
  const dryRun = opts.dryRun === true;

  let updated = 0;
  let created = 0;
  let skipped = 0;
  const errors: FatturaImportError[] = [];

  const touchedIds = new Set<string>();

  for (const row of rows) {
    const med = indexes.mediazioneByRgm.get(row.rgmKey);
    if (!med) {
      skipped++;
      errors.push({ index: row.index, error: "RGM non trovato", rgm: row.rgm, cliente: row.cliente });
      continue;
    }

    const parti = indexes.partiByMediazione.get(med.id) ?? [];
    const parteMatch = matchPartecipazione(parti, row.cliente);
    if (!parteMatch.ok) {
      skipped++;
      errors.push({ index: row.index, error: parteMatch.reason, rgm: row.rgm, cliente: row.cliente });
      continue;
    }

    const fatture = indexes.fattureByParte.get(parteMatch.parte.id) ?? [];
    const fattMatch = matchFattura(fatture, row);

    if (fattMatch.ok) {
      const patch = buildUpdatePayload(fattMatch.fattura, row);
      if (!patch) {
        skipped++;
        continue;
      }

      if (dryRun) {
        touchedIds.add(fattMatch.fattura.id);
        updated++;
        continue;
      }

      try {
        await pb.collection("fatture").update(fattMatch.fattura.id, patch);
        Object.assign(fattMatch.fattura, patch);
        touchedIds.add(fattMatch.fattura.id);
        updated++;
      } catch (e) {
        errors.push({
          index: row.index,
          error: e instanceof Error ? e.message : "Update fallito",
          rgm: row.rgm,
          cliente: row.cliente,
        });
      }
      continue;
    }

    if (fattMatch.reason === "ambiguous") {
      skipped++;
      errors.push({
        index: row.index,
        error: fattMatch.detail,
        rgm: row.rgm,
        cliente: row.cliente,
      });
      continue;
    }

    // not_found → create
    const createPayload = buildCreatePayload(med.id, parteMatch.parte.id, row);
    if (!createPayload) {
      skipped++;
      errors.push({
        index: row.index,
        error: "Dati insufficienti per creare fattura",
        rgm: row.rgm,
        cliente: row.cliente,
      });
      continue;
    }

    if (dryRun) {
      created++;
      continue;
    }

    try {
      const createdRec = (await pb.collection("fatture").create(createPayload)) as FatturaLite;
      const lite: FatturaLite = {
        id: createdRec.id,
        mediazione: med.id,
        partecipazione: parteMatch.parte.id,
        numero_fattura: row.numero_fattura || undefined,
        data_emissione_fattura: row.data_emissione || undefined,
        data_incasso: row.data_incasso || undefined,
        imponibile: row.imponibile ?? undefined,
        nota: (createPayload.nota as string | undefined) || undefined,
      };
      const list = indexes.fattureByParte.get(parteMatch.parte.id) ?? [];
      list.push(lite);
      indexes.fattureByParte.set(parteMatch.parte.id, list);
      touchedIds.add(lite.id);
      created++;
    } catch (e) {
      errors.push({
        index: row.index,
        error: e instanceof Error ? e.message : "Create fallita",
        rgm: row.rgm,
        cliente: row.cliente,
      });
    }
  }

  return {
    success: updated + created,
    updated,
    created,
    skipped,
    errors,
  };
}
