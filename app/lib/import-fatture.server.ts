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
  scoreClienteLabel,
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

function almostEqual(a: number | null | undefined, b: number | null | undefined, eps = 0.02): boolean {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < eps;
}

function soggettoLabels(s: SoggettoLite | undefined): string[] {
  if (!s) return [];
  const labels: string[] = [];
  const rs = s.ragione_sociale || "";
  if (rs.trim()) labels.push(rs);
  const cognome = s.cognome || "";
  if (cognome.trim()) labels.push(cognome);
  const full = [s.nome, s.cognome].filter(Boolean).join(" ");
  if (full.trim()) labels.push(full);
  const reverse = [s.cognome, s.nome].filter(Boolean).join(" ");
  if (reverse.trim() && reverse !== full) labels.push(reverse);
  return labels;
}

function bestScoreForParte(p: PartecipazioneLite, cliente: string): number {
  let best = 0;
  for (const label of soggettoLabels(p.expand?.soggetto)) {
    best = Math.max(best, scoreClienteLabel(cliente, label));
  }
  return best;
}

/**
 * Fuzzy match partecipazione. If multiple winners share the same soggetto, prefer
 * the one that already has fatture (optional hint via fattureByParte).
 */
function matchPartecipazione(
  parti: PartecipazioneLite[],
  cliente: string,
  opts: { preferParteIds?: Set<string> } = {}
): { ok: true; parte: PartecipazioneLite } | { ok: false; reason: string } {
  if (!normalizePersonKey(cliente)) return { ok: false, reason: "Cliente vuoto" };

  // Slash / compound: "LUCISANO/TUCCI M" — try each side and take best unique
  const variants = cliente.includes("/")
    ? [cliente, ...cliente.split("/").map((p) => p.trim()).filter(Boolean)]
    : [cliente];

  type Scored = { p: PartecipazioneLite; score: number };
  const scored: Scored[] = [];
  for (const p of parti) {
    let score = 0;
    for (const v of variants) score = Math.max(score, bestScoreForParte(p, v));
    if (score >= 55) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { ok: false, reason: `Parte non trovata: ${cliente}` };

  const best = scored[0]!.score;
  let winners = scored.filter((s) => s.score >= best - 5);

  if (winners.length > 1 && opts.preferParteIds?.size) {
    const preferred = winners.filter((w) => opts.preferParteIds!.has(w.p.id));
    if (preferred.length === 1) winners = preferred;
    else if (preferred.length > 1) winners = preferred;
  }

  // Same soggetto on multiple partecipazioni → pick one (prefer with fatture hint, else first)
  if (winners.length > 1) {
    const sogIds = new Set(winners.map((w) => w.p.soggetto));
    if (sogIds.size === 1) {
      const withHint = winners.find((w) => opts.preferParteIds?.has(w.p.id));
      return { ok: true, parte: (withHint ?? winners[0]!).p };
    }
    // Distinct people still ambiguous (e.g. Lucisano Federica vs Paola)
    return { ok: false, reason: `Parte ambigua: ${cliente}` };
  }

  return { ok: true, parte: winners[0]!.p };
}

function fattureMatchingNumero(
  fatture: FatturaLite[],
  numero: string,
  year: string | null
): FatturaLite[] {
  const out: FatturaLite[] = [];
  for (const f of fatture) {
    const num = String(f.numero_fattura ?? "").trim();
    if (num && num === numero) {
      out.push(f);
      continue;
    }
    if (notaMatchesNumero(f.nota, numero, year)) {
      out.push(f);
      continue;
    }
    // "Fatt. 3/2024 (rata 1/3)" — match numero even if year filter failed on partial nota
    const m = String(f.nota ?? "").match(/fatt\.?\s*(\d+)\s*\/\s*(\d{4})/i);
    if (m && m[1] === numero && (!year || m[2] === year)) out.push(f);
  }
  return out;
}

function sumImponibile(list: FatturaLite[]): number {
  return list.reduce((a, f) => a + (Number(f.imponibile) || 0), 0);
}

/**
 * Match one fattura, or a rate-bundle (same numero, rates that sum to Excel total).
 */
function matchFattura(
  fatture: FatturaLite[],
  row: FatturaImportRow
):
  | { ok: true; fatture: FatturaLite[]; mode: "single" | "rate_bundle" }
  | { ok: false; reason: "not_found" | "ambiguous"; detail: string } {
  if (fatture.length === 0) {
    return { ok: false, reason: "not_found", detail: "Nessuna fattura esistente per la parte" };
  }

  const year = yearFromISO(row.data_emissione);
  let candidates: FatturaLite[] = [];

  if (row.numero_fattura) {
    candidates = fattureMatchingNumero(fatture, row.numero_fattura, year);
  }

  if (candidates.length === 0 && row.imponibile != null) {
    candidates = fatture.filter((f) => almostEqual(f.imponibile, row.imponibile));
    if (candidates.length > 1 && row.data_emissione) {
      const dated = candidates.filter((f) => dateKey(f.data_emissione_fattura) === row.data_emissione);
      if (dated.length > 0) candidates = dated;
    }
  }

  if (candidates.length === 0) {
    return { ok: false, reason: "not_found", detail: "Fattura esistente non trovata" };
  }

  if (candidates.length === 1) {
    return { ok: true, fatture: candidates, mode: "single" };
  }

  // Multiple with same numero: try exact imponibile (single rate line)
  if (row.imponibile != null) {
    const byImp = candidates.filter((f) => almostEqual(f.imponibile, row.imponibile));
    if (byImp.length === 1) {
      return { ok: true, fatture: byImp, mode: "single" };
    }
    // Excel total == sum of all rows with that numero → rate division (OK)
    const sum = sumImponibile(candidates);
    if (almostEqual(sum, row.imponibile, 0.05)) {
      return { ok: true, fatture: candidates, mode: "rate_bundle" };
    }
    // Excel total == sum of only "(rata …)" rows (exclude the full invoice twin)
    const rateOnly = candidates.filter((f) => /rata/i.test(String(f.nota ?? "")));
    if (rateOnly.length >= 2 && almostEqual(sumImponibile(rateOnly), row.imponibile, 0.05)) {
      return { ok: true, fatture: rateOnly, mode: "rate_bundle" };
    }
  } else if (row.numero_fattura) {
    // No imponibile on Excel but same numero → update all rate rows' metadata
    return { ok: true, fatture: candidates, mode: "rate_bundle" };
  }

  // Identical duplicates (same n + same imp twice): update first only
  if (
    candidates.length === 2 &&
    row.imponibile != null &&
    almostEqual(candidates[0]!.imponibile, candidates[1]!.imponibile) &&
    almostEqual(candidates[0]!.imponibile, row.imponibile)
  ) {
    return { ok: true, fatture: [candidates[0]!], mode: "single" };
  }

  return {
    ok: false,
    reason: "ambiguous",
    detail: `Fattura ambigua (${candidates.length} match)`,
  };
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
    // Prefer partecipazioni that already have fatture (helps duplicate Istante/Chiamato same person)
    const preferParteIds = new Set<string>();
    for (const p of parti) {
      const fl = indexes.fattureByParte.get(p.id) ?? [];
      if (fl.length === 0) continue;
      if (row.numero_fattura) {
        const year = yearFromISO(row.data_emissione);
        if (fattureMatchingNumero(fl, row.numero_fattura, year).length > 0) {
          preferParteIds.add(p.id);
          continue;
        }
      }
      if (row.imponibile != null && fl.some((f) => almostEqual(f.imponibile, row.imponibile))) {
        preferParteIds.add(p.id);
      } else if (!row.numero_fattura) {
        preferParteIds.add(p.id);
      }
    }

    const parteMatch = matchPartecipazione(parti, row.cliente, { preferParteIds });
    if (!parteMatch.ok) {
      skipped++;
      errors.push({ index: row.index, error: parteMatch.reason, rgm: row.rgm, cliente: row.cliente });
      continue;
    }

    const fatture = indexes.fattureByParte.get(parteMatch.parte.id) ?? [];
    const fattMatch = matchFattura(fatture, row);

    if (fattMatch.ok) {
      let anyPatched = false;
      for (const fattura of fattMatch.fatture) {
        // For rate bundles, never overwrite per-rate imponibile with the Excel total
        const rowForPatch =
          fattMatch.mode === "rate_bundle"
            ? { ...row, imponibile: null as number | null }
            : row;
        const patch = buildUpdatePayload(fattura, rowForPatch);
        if (!patch) continue;
        anyPatched = true;

        if (dryRun) {
          touchedIds.add(fattura.id);
          continue;
        }

        try {
          await pb.collection("fatture").update(fattura.id, patch);
          Object.assign(fattura, patch);
          touchedIds.add(fattura.id);
        } catch (e) {
          errors.push({
            index: row.index,
            error: e instanceof Error ? e.message : "Update fallito",
            rgm: row.rgm,
            cliente: row.cliente,
          });
        }
      }
      if (anyPatched) updated++;
      else skipped++;
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
