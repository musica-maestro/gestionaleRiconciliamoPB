/** Normalize competenza location for case-insensitive matching (e.g. ROMA → roma). */
export function normalizeCompetenzaKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Map a raw location to the canonical active option nome when present
 * (e.g. ROMA → Roma). Falls back to title-case if no active match.
 */
export function resolveCompetenzaNome(
  raw: string | null | undefined,
  options: Array<{ nome?: string | null; attivo?: boolean | null }>,
): string {
  const key = normalizeCompetenzaKey(raw);
  if (!key) return "";
  for (const o of options) {
    if (o.attivo === false) continue;
    const nome = String(o.nome ?? "").trim();
    if (normalizeCompetenzaKey(nome) === key) return nome;
  }
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** True when the mediazione competenza matches an active option (case-insensitive). */
export function isCompetenzaAttiva(
  competenza: string | null | undefined,
  competenzeAttiveKeys: Iterable<string> | Set<string>,
): boolean {
  const key = normalizeCompetenzaKey(competenza);
  if (!key) return false;
  const set =
    competenzeAttiveKeys instanceof Set
      ? competenzeAttiveKeys
      : new Set(
          [...competenzeAttiveKeys].map(normalizeCompetenzaKey).filter(Boolean),
        );
  return set.has(key);
}

/** Build a Set of normalized keys from competenza_opzioni records. */
export function competenzeAttiveKeySet(
  options: Array<{ nome?: string | null }>,
): Set<string> {
  return new Set(
    options.map((o) => normalizeCompetenzaKey(o.nome)).filter(Boolean),
  );
}
