export type RubricaKind = "soggetti" | "avvocati";
export type RubricaTipo = "fisica" | "giuridica" | "avvocato";

export type RubricaRow = {
  id: string;
  kind: RubricaKind;
  tipo: RubricaTipo;
  tipoLabel: string;
  display: string;
  codice_fiscale: string;
  comune: string;
  provincia: string;
  cap: string;
  email_pec: string;
  telefono: string;
  foro: string;
};

export type RubricaFilters = {
  q?: string;
  tipo?: string;
  cf?: string;
  comune?: string;
  provincia?: string;
  cap?: string;
  email_pec?: string;
  telefono?: string;
};

const TIPO_LABEL: Record<RubricaTipo, string> = {
  fisica: "Persona fisica",
  giuridica: "Persona giuridica",
  avvocato: "Avvocato",
};

function includes(haystack: unknown, needle: string): boolean {
  return String(haystack ?? "").toLowerCase().includes(needle);
}

export function buildRubricaRows(
  soggetti: Record<string, unknown>[],
  avvocati: Record<string, unknown>[],
): RubricaRow[] {
  const soggettoRows: RubricaRow[] = soggetti.map((s) => {
    const tipo: RubricaTipo = s.tipo === "Giuridica" ? "giuridica" : "fisica";
    const display =
      tipo === "giuridica"
        ? String(s.ragione_sociale || "—")
        : [s.nome, s.cognome].filter(Boolean).join(" ") || "—";
    const email = String(s.email ?? "").trim();
    const pec = String(s.pec ?? "").trim();
    return {
      id: String(s.id),
      kind: "soggetti",
      tipo,
      tipoLabel: TIPO_LABEL[tipo],
      display,
      codice_fiscale: String(s.codice_fiscale ?? ""),
      comune: String(s.comune ?? ""),
      provincia: String(s.provincia ?? ""),
      cap: String(s.cap ?? ""),
      email_pec: email || pec,
      telefono: "",
      foro: "",
    };
  });

  const avvocatoRows: RubricaRow[] = avvocati.map((a) => ({
    id: String(a.id),
    kind: "avvocati",
    tipo: "avvocato" as const,
    tipoLabel: TIPO_LABEL.avvocato,
    display: [a.nome, a.cognome].filter(Boolean).join(" ") || "—",
    codice_fiscale: String(a.codice_fiscale ?? ""),
    comune: "",
    provincia: "",
    cap: "",
    email_pec: String(a.pec ?? ""),
    telefono: String(a.telefono ?? ""),
    foro: String(a.foro_di_appartenenza ?? ""),
  }));

  return [...soggettoRows, ...avvocatoRows];
}

export function filterRubricaRows(rows: RubricaRow[], filters: RubricaFilters): RubricaRow[] {
  let out = rows;
  const tipo = filters.tipo?.trim();
  if (tipo === "fisica" || tipo === "giuridica" || tipo === "avvocato") {
    out = out.filter((r) => r.tipo === tipo);
  }
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) =>
        includes(r.display, q) ||
        includes(r.codice_fiscale, q) ||
        includes(r.comune, q) ||
        includes(r.email_pec, q) ||
        includes(r.telefono, q) ||
        includes(r.foro, q),
    );
  }
  const cf = filters.cf?.trim().toLowerCase();
  if (cf) out = out.filter((r) => includes(r.codice_fiscale, cf));
  const comune = filters.comune?.trim().toLowerCase();
  if (comune) out = out.filter((r) => includes(r.comune, comune));
  const provincia = filters.provincia?.trim().toLowerCase();
  if (provincia) out = out.filter((r) => includes(r.provincia, provincia));
  const cap = filters.cap?.trim().toLowerCase();
  if (cap) out = out.filter((r) => includes(r.cap, cap));
  const email_pec = filters.email_pec?.trim().toLowerCase();
  if (email_pec) out = out.filter((r) => includes(r.email_pec, email_pec));
  const telefono = filters.telefono?.trim().toLowerCase();
  if (telefono) out = out.filter((r) => includes(r.telefono, telefono) || includes(r.foro, telefono));
  return out;
}

export function sortRubricaRows(rows: RubricaRow[], field: string, order: "asc" | "desc"): RubricaRow[] {
  return [...rows].sort((a, b) => {
    const va = String((a as Record<string, unknown>)[field] ?? "").toLowerCase();
    const vb = String((b as Record<string, unknown>)[field] ?? "").toLowerCase();
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return order === "asc" ? cmp : -cmp;
  });
}

export function parseRubricaFilters(url: URL): RubricaFilters {
  return {
    q: url.searchParams.get("q")?.trim() ?? "",
    tipo: url.searchParams.get("tipo")?.trim() ?? "",
    cf: url.searchParams.get("cf")?.trim() ?? "",
    comune: url.searchParams.get("comune")?.trim() ?? "",
    provincia: url.searchParams.get("provincia")?.trim() ?? "",
    cap: url.searchParams.get("cap")?.trim() ?? "",
    email_pec: url.searchParams.get("email_pec")?.trim() ?? "",
    telefono: url.searchParams.get("telefono")?.trim() ?? "",
  };
}
