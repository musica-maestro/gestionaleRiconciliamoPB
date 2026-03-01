import { Link, useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Rubrica" }];
import { requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import {
  FilterableTable,
  FilterTextInput,
  FilterSelect,
  SortLink,
  filterableTableThClass,
  filterableTableHeaderLabelClass,
} from "~/components/data-table";
import { ChevronLeft, ChevronRight } from "lucide-react";

const MAIN_COLOR = "#3aaeba";
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "soggetti";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const tipo = url.searchParams.get("tipo")?.trim() ?? "";
  const comune = url.searchParams.get("comune")?.trim() ?? "";
  const cf = url.searchParams.get("cf")?.trim() ?? "";
  const provincia = url.searchParams.get("provincia")?.trim() ?? "";
  const cap = url.searchParams.get("cap")?.trim() ?? "";
  const email_pec = url.searchParams.get("email_pec")?.trim() ?? "";
  const foro = url.searchParams.get("foro")?.trim() ?? "";
  const pec_avv = url.searchParams.get("pec_avv")?.trim() ?? "";
  const telefono = url.searchParams.get("telefono")?.trim() ?? "";
  const tessera_foro = url.searchParams.get("tessera_foro")?.trim() ?? "";
  const sortSoggetti = url.searchParams.get("sort_s") || "display";
  const orderSoggetti = url.searchParams.get("order_s") === "asc" ? "asc" : "desc";
  const sortAvvocati = url.searchParams.get("sort_a") || "display";
  const orderAvvocati = url.searchParams.get("order_a") === "asc" ? "asc" : "desc";

  const pageS = Math.max(1, parseInt(url.searchParams.get("page_s") ?? "1", 10) || 1);
  const perPageS = PER_PAGE_OPTIONS.includes(Number(url.searchParams.get("per_page_s")) as (typeof PER_PAGE_OPTIONS)[number])
    ? (Number(url.searchParams.get("per_page_s")) as (typeof PER_PAGE_OPTIONS)[number])
    : 10;
  const pageA = Math.max(1, parseInt(url.searchParams.get("page_a") ?? "1", 10) || 1);
  const perPageA = PER_PAGE_OPTIONS.includes(Number(url.searchParams.get("per_page_a")) as (typeof PER_PAGE_OPTIONS)[number])
    ? (Number(url.searchParams.get("per_page_a")) as (typeof PER_PAGE_OPTIONS)[number])
    : 10;

  const [soggettiResp, avvocatiResp] = await Promise.all([
    pb.collection("soggetti").getFullList({ sort: "nome,cognome,ragione_sociale" }),
    pb.collection("avvocati").getFullList({ sort: "cognome,nome" }),
  ]);

  const filterLower = q.toLowerCase();
  let soggettiList = soggettiResp as Record<string, unknown>[];
  if (q) {
    soggettiList = soggettiList.filter((s: Record<string, unknown>) => {
      const nome = String(s.nome ?? "").toLowerCase();
      const cognome = String(s.cognome ?? "").toLowerCase();
      const rs = String(s.ragione_sociale ?? "").toLowerCase();
      const cfS = String(s.codice_fiscale ?? "").toLowerCase();
      const comuneS = String(s.comune ?? "").toLowerCase();
      return [nome, cognome, rs, cfS, comuneS].some((x) => x.includes(filterLower));
    });
  }
  if (tipo) soggettiList = soggettiList.filter((s: Record<string, unknown>) => s.tipo === tipo);
  if (comune) {
    const c = comune.toLowerCase();
    soggettiList = soggettiList.filter((s: Record<string, unknown>) => String(s.comune ?? "").toLowerCase().includes(c));
  }
  if (cf) {
    const c = cf.toLowerCase();
    soggettiList = soggettiList.filter((s: Record<string, unknown>) => String(s.codice_fiscale ?? "").toLowerCase().includes(c));
  }
  if (provincia) {
    const p = provincia.toLowerCase();
    soggettiList = soggettiList.filter((s: Record<string, unknown>) => String(s.provincia ?? "").toLowerCase().includes(p));
  }
  if (cap) {
    const c = cap.toLowerCase();
    soggettiList = soggettiList.filter((s: Record<string, unknown>) => String(s.cap ?? "").toLowerCase().includes(c));
  }
  if (email_pec) {
    const e = email_pec.toLowerCase();
    soggettiList = soggettiList.filter((s: Record<string, unknown>) => {
      const email = String(s.email ?? "").toLowerCase();
      const pec = String(s.pec ?? "").toLowerCase();
      return email.includes(e) || pec.includes(e);
    });
  }

  let avvocatiList = avvocatiResp as Record<string, unknown>[];
  if (q) {
    const ql = q.toLowerCase();
    avvocatiList = avvocatiList.filter((a: Record<string, unknown>) => {
      const nome = String(a.nome ?? "").toLowerCase();
      const cognome = String(a.cognome ?? "").toLowerCase();
      const foroS = String(a.foro_di_appartenenza ?? "").toLowerCase();
      const pecS = String(a.pec ?? "").toLowerCase();
      return [nome, cognome, foroS, pecS].some((x) => x.includes(ql));
    });
  }
  if (foro) {
    const f = foro.toLowerCase();
    avvocatiList = avvocatiList.filter((a: Record<string, unknown>) => String(a.foro_di_appartenenza ?? "").toLowerCase().includes(f));
  }
  if (pec_avv) {
    const p = pec_avv.toLowerCase();
    avvocatiList = avvocatiList.filter((a: Record<string, unknown>) => String(a.pec ?? "").toLowerCase().includes(p));
  }
  if (telefono) {
    const t = telefono.toLowerCase();
    avvocatiList = avvocatiList.filter((a: Record<string, unknown>) => String(a.telefono ?? "").toLowerCase().includes(t));
  }
  if (tessera_foro) {
    const tf = tessera_foro.toLowerCase();
    avvocatiList = avvocatiList.filter((a: Record<string, unknown>) => String(a.numero_tessera_foro ?? "").toLowerCase().includes(tf));
  }

  const soggettiRows = soggettiList.map((s: Record<string, unknown>) => ({
    id: s.id,
    tipo: s.tipo,
    nome: s.nome ?? "",
    cognome: s.cognome ?? "",
    ragione_sociale: s.ragione_sociale ?? "",
    codice_fiscale: s.codice_fiscale ?? "",
    comune: s.comune ?? "",
    provincia: s.provincia ?? "",
    cap: s.cap ?? "",
    email: s.email ?? "",
    pec: s.pec ?? "",
    display: s.tipo === "Giuridica" ? (s.ragione_sociale || "—") : [s.nome, s.cognome].filter(Boolean).join(" ") || "—",
  }));
  const avvocatiRows = avvocatiList.map((a: Record<string, unknown>) => ({
    id: a.id,
    nome: a.nome ?? "",
    cognome: a.cognome ?? "",
    pec: a.pec ?? "",
    telefono: a.telefono ?? "",
    foro_di_appartenenza: a.foro_di_appartenenza ?? "",
    numero_tessera_foro: a.numero_tessera_foro ?? "",
    display: [a.nome, a.cognome].filter(Boolean).join(" ") || "—",
  }));

  const sortRows = <T,>(rows: T[], field: string, order: string) => {
    return [...rows].sort((a, b) => {
      const va = String((a as Record<string, unknown>)[field] ?? "").toLowerCase();
      const vb = String((b as Record<string, unknown>)[field] ?? "").toLowerCase();
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return order === "asc" ? cmp : -cmp;
    });
  };
  const soggettiSorted = sortRows(soggettiRows, sortSoggetti, orderSoggetti);
  const avvocatiSorted = sortRows(avvocatiRows, sortAvvocati, orderAvvocati);

  const totalSoggetti = soggettiSorted.length;
  const totalPagesS = Math.max(1, Math.ceil(totalSoggetti / perPageS));
  const soggetti = soggettiSorted.slice((pageS - 1) * perPageS, pageS * perPageS);

  const totalAvvocati = avvocatiSorted.length;
  const totalPagesA = Math.max(1, Math.ceil(totalAvvocati / perPageA));
  const avvocati = avvocatiSorted.slice((pageA - 1) * perPageA, pageA * perPageA);

  return json({
    soggetti,
    avvocati,
    q,
    tab,
    filters: { tipo, comune, cf, provincia, cap, email_pec, foro, pec_avv, telefono, tessera_foro },
    sortSoggetti,
    orderSoggetti,
    sortAvvocati,
    orderAvvocati,
    pageS,
    perPageS,
    totalPagesS,
    totalItemsS: totalSoggetti,
    pageA,
    perPageA,
    totalPagesA,
    totalItemsA: totalAvvocati,
  });
}

function buildPageUrlRubrica(basePath: string, searchParams: URLSearchParams, page: number, paramPrefix: "s" | "a"): string {
  const next = new URLSearchParams(searchParams);
  next.set(`page_${paramPrefix}`, String(page));
  return `${basePath}?${next.toString()}`;
}

function buildPerPageUrlRubrica(basePath: string, searchParams: URLSearchParams, perPage: number, paramPrefix: "s" | "a"): string {
  const next = new URLSearchParams(searchParams);
  next.set(`per_page_${paramPrefix}`, String(perPage));
  next.set(`page_${paramPrefix}`, "1");
  return `${basePath}?${next.toString()}`;
}

const TIPO_OPTIONS = [
  { value: "Fisica", label: "Fisica" },
  { value: "Giuridica", label: "Giuridica" },
];

export default function RubricaIndex() {
  const {
    soggetti,
    avvocati,
    q,
    tab,
    filters,
    sortSoggetti,
    orderSoggetti,
    sortAvvocati,
    orderAvvocati,
    pageS,
    perPageS,
    totalPagesS,
    totalItemsS,
    pageA,
    perPageA,
    totalPagesA,
    totalItemsA,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const headerBgSolid = "bg-base-200";
  const zebraEven = { backgroundColor: `${MAIN_COLOR}08` };

  const paginationFooterS = (
    <div className={`flex flex-wrap items-center justify-between gap-3 py-4 px-4 border-t border-base-200 ${headerBgSolid}`}>
      <div className="flex items-center gap-4 flex-nowrap">
        <p className="text-sm text-base-content/70">
          Pagina {pageS} di {totalPagesS} ({totalItemsS} soggetti)
        </p>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap shrink-0">
          <span className="text-base-content/70">Per pagina:</span>
          <select
            value={perPageS}
            onChange={(e) => navigate(buildPerPageUrlRubrica("/rubrica", searchParams, Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number], "s"))}
            className="select select-bordered select-sm"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {totalPagesS > 1 && (
        <div className="flex items-center gap-1">
          <Link
            to={buildPageUrlRubrica("/rubrica", searchParams, pageS - 1, "s")}
            className={`btn btn-sm btn-ghost btn-square ${pageS <= 1 ? "btn-disabled" : ""}`}
            aria-disabled={pageS <= 1}
            aria-label="Pagina precedente"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-1 px-2 flex-wrap">
            {(() => {
              const links: (number | "ellipsis")[] = [];
              if (totalPagesS <= 5) {
                for (let i = 1; i <= totalPagesS; i++) links.push(i);
              } else {
                links.push(1);
                if (pageS <= 3) links.push(2, 3, "ellipsis", totalPagesS);
                else if (pageS >= totalPagesS - 2) links.push("ellipsis", totalPagesS - 2, totalPagesS - 1, totalPagesS);
                else links.push("ellipsis", pageS - 1, pageS, pageS + 1, "ellipsis", totalPagesS);
              }
              return links.map((item, i) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-s-${i}`} className="px-1 text-base-content/50">…</span>
                ) : (
                  <Link
                    key={item}
                    to={buildPageUrlRubrica("/rubrica", searchParams, item, "s")}
                    className={`btn btn-sm min-w-[2rem] ${item === pageS ? "btn-primary" : "btn-ghost"}`}
                  >
                    {item}
                  </Link>
                )
              );
            })()}
          </div>
          <Link
            to={buildPageUrlRubrica("/rubrica", searchParams, pageS + 1, "s")}
            className={`btn btn-sm btn-ghost btn-square ${pageS >= totalPagesS ? "btn-disabled" : ""}`}
            aria-disabled={pageS >= totalPagesS}
            aria-label="Pagina successiva"
          >
            <ChevronRight className="h-5 w-5" />
          </Link>
        </div>
      )}
    </div>
  );

  const paginationFooterA = (
    <div className={`flex flex-wrap items-center justify-between gap-3 py-4 px-4 border-t border-base-200 ${headerBgSolid}`}>
      <div className="flex items-center gap-4 flex-nowrap">
        <p className="text-sm text-base-content/70">
          Pagina {pageA} di {totalPagesA} ({totalItemsA} avvocati)
        </p>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap shrink-0">
          <span className="text-base-content/70">Per pagina:</span>
          <select
            value={perPageA}
            onChange={(e) => navigate(buildPerPageUrlRubrica("/rubrica", searchParams, Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number], "a"))}
            className="select select-bordered select-sm"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {totalPagesA > 1 && (
        <div className="flex items-center gap-1">
          <Link
            to={buildPageUrlRubrica("/rubrica", searchParams, pageA - 1, "a")}
            className={`btn btn-sm btn-ghost btn-square ${pageA <= 1 ? "btn-disabled" : ""}`}
            aria-disabled={pageA <= 1}
            aria-label="Pagina precedente"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-1 px-2 flex-wrap">
            {(() => {
              const links: (number | "ellipsis")[] = [];
              if (totalPagesA <= 5) {
                for (let i = 1; i <= totalPagesA; i++) links.push(i);
              } else {
                links.push(1);
                if (pageA <= 3) links.push(2, 3, "ellipsis", totalPagesA);
                else if (pageA >= totalPagesA - 2) links.push("ellipsis", totalPagesA - 2, totalPagesA - 1, totalPagesA);
                else links.push("ellipsis", pageA - 1, pageA, pageA + 1, "ellipsis", totalPagesA);
              }
              return links.map((item, i) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-a-${i}`} className="px-1 text-base-content/50">…</span>
                ) : (
                  <Link
                    key={item}
                    to={buildPageUrlRubrica("/rubrica", searchParams, item, "a")}
                    className={`btn btn-sm min-w-[2rem] ${item === pageA ? "btn-primary" : "btn-ghost"}`}
                  >
                    {item}
                  </Link>
                )
              );
            })()}
          </div>
          <Link
            to={buildPageUrlRubrica("/rubrica", searchParams, pageA + 1, "a")}
            className={`btn btn-sm btn-ghost btn-square ${pageA >= totalPagesA ? "btn-disabled" : ""}`}
            aria-disabled={pageA >= totalPagesA}
            aria-label="Pagina successiva"
          >
            <ChevronRight className="h-5 w-5" />
          </Link>
        </div>
      )}
    </div>
  );

  const tabParams = (t: string) => {
    const p = new URLSearchParams(searchParams);
    p.set("tab", t);
    return p.toString();
  };

  const azzeraUrl = tab === "soggetti" ? "/rubrica?tab=soggetti" : "/rubrica?tab=avvocati";

  const sortLinkPropsS = {
    basePath: "/rubrica",
    sortParam: "sort_s" as const,
    orderParam: "order_s" as const,
    currentSort: sortSoggetti,
    currentOrder: orderSoggetti,
    searchParams,
  };
  const sortLinkPropsA = {
    basePath: "/rubrica",
    sortParam: "sort_a" as const,
    orderParam: "order_a" as const,
    currentSort: sortAvvocati,
    currentOrder: orderAvvocati,
    searchParams,
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-base-200/60 border border-base-300 w-fit">
          <Link
            to={`?${tabParams("soggetti")}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "soggetti" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/80 hover:text-base-content hover:bg-base-300/50"}`}
          >
            Soggetti
          </Link>
          <Link
            to={`?${tabParams("avvocati")}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "avvocati" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/80 hover:text-base-content hover:bg-base-300/50"}`}
          >
            Avvocati
          </Link>
        </div>
        <button
          type="button"
          onClick={() => navigate(azzeraUrl)}
          className="btn btn-soft btn-sm"
        >
          Azzera filtri
        </button>
      </div>

      {tab === "soggetti" && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8">
          <FilterableTable
            id="rubrica-soggetti-filters-form"
            method="get"
            hiddenFields={{
              tab: "soggetti",
              sort_s: sortSoggetti,
              order_s: orderSoggetti,
              page_s: "1",
              per_page_s: String(perPageS),
            }}
            className="overflow-visible"
            footer={paginationFooterS}
          >
            <div>
              <table className="table table-sm w-full min-w-[800px]">
                <thead className={`sticky top-0 z-10 shadow-sm ${headerBgSolid}`}>
                <tr>
                  <th className={`${filterableTableThClass} min-w-[100px]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Soggetto" field="display" {...sortLinkPropsS} />
                    </div>
                    <FilterTextInput name="q" type="search" defaultValue={q} placeholder="Cerca…" />
                  </th>
                  <th className={`${filterableTableThClass} min-w-[100px]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Tipo" field="tipo" {...sortLinkPropsS} />
                    </div>
                    <FilterSelect name="tipo" defaultValue={filters.tipo} options={TIPO_OPTIONS} emptyLabel="Tutti" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="CF" field="codice_fiscale" {...sortLinkPropsS} />
                    </div>
                    <FilterTextInput name="cf" defaultValue={filters.cf} placeholder="CF" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Comune" field="comune" {...sortLinkPropsS} />
                    </div>
                    <FilterTextInput name="comune" defaultValue={filters.comune} placeholder="Comune" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Provincia" field="provincia" {...sortLinkPropsS} />
                    </div>
                    <FilterTextInput name="provincia" defaultValue={filters.provincia} placeholder="Provincia" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="CAP" field="cap" {...sortLinkPropsS} />
                    </div>
                    <FilterTextInput name="cap" defaultValue={filters.cap} placeholder="CAP" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>Email / PEC</div>
                    <FilterTextInput name="email_pec" defaultValue={filters.email_pec} placeholder="Email o PEC" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {soggetti.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-base-content/70 py-12">
                      Nessun soggetto trovato.
                    </td>
                  </tr>
                ) : (
                  soggetti.map((s, idx) => (
                    <tr key={String(s.id)} className="hover" style={idx % 2 === 1 ? zebraEven : undefined}>
                      <td className="py-2"><Link to={`/rubrica/soggetti/${s.id}`} className="link link-hover font-medium">{s.display}</Link></td>
                      <td className="py-2">{s.tipo}</td>
                      <td className="py-2">{s.codice_fiscale || "—"}</td>
                      <td className="py-2">{s.comune || "—"}</td>
                      <td className="py-2">{s.provincia || "—"}</td>
                      <td className="py-2">{s.cap || "—"}</td>
                      <td className="py-2 max-w-[200px] truncate" title={s.email || s.pec || ""}>{s.email || s.pec || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </FilterableTable>
        </div>
      )}

      {tab === "avvocati" && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8">
          <FilterableTable
            id="rubrica-avvocati-filters-form"
            method="get"
            hiddenFields={{
              tab: "avvocati",
              sort_a: sortAvvocati,
              order_a: orderAvvocati,
              page_a: "1",
              per_page_a: String(perPageA),
            }}
            className="overflow-visible"
            footer={paginationFooterA}
          >
            <div>
              <table className="table table-sm w-full min-w-[700px]">
                <thead className={`sticky top-0 z-10 shadow-sm ${headerBgSolid}`}>
                <tr>
                  <th className={`${filterableTableThClass} min-w-[100px]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Nome" field="display" {...sortLinkPropsA} />
                    </div>
                    <FilterTextInput name="q" type="search" defaultValue={q} placeholder="Cerca…" />
                  </th>
                  <th className={`${filterableTableThClass} min-w-[140px]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="PEC" field="pec" {...sortLinkPropsA} />
                    </div>
                    <FilterTextInput name="pec_avv" defaultValue={filters.pec_avv} placeholder="PEC" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Telefono" field="telefono" {...sortLinkPropsA} />
                    </div>
                    <FilterTextInput name="telefono" defaultValue={filters.telefono} placeholder="Telefono" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Foro" field="foro_di_appartenenza" {...sortLinkPropsA} />
                    </div>
                    <FilterTextInput name="foro" defaultValue={filters.foro} placeholder="Foro" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="N. tessera foro" field="numero_tessera_foro" {...sortLinkPropsA} />
                    </div>
                    <FilterTextInput name="tessera_foro" defaultValue={filters.tessera_foro} placeholder="N. tessera" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {avvocati.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-base-content/70 py-12">
                      Nessun avvocato trovato.
                    </td>
                  </tr>
                ) : (
                  avvocati.map((a, idx) => (
                    <tr key={String(a.id)} className="hover" style={idx % 2 === 1 ? zebraEven : undefined}>
                      <td className="py-2"><Link to={`/rubrica/avvocati/${a.id}`} className="link link-hover font-medium">{a.display}</Link></td>
                      <td className="py-2 max-w-[220px] truncate" title={a.pec || ""}>{a.pec || "—"}</td>
                      <td className="py-2">{a.telefono || "—"}</td>
                      <td className="py-2">{a.foro_di_appartenenza || "—"}</td>
                      <td className="py-2">{a.numero_tessera_foro || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </FilterableTable>
        </div>
      )}
    </div>
  );
}
