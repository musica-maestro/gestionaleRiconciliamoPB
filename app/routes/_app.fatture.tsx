import { useState } from "react";
import { Link, useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Fatture" }];
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import {
  FilterableTable,
  FilterTextInput,
  FilterDateRange,
  SortLink,
  filterableTableThClass,
  filterableTableHeaderLabelClass,
} from "~/components/data-table";
import { Eye, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";

const SORT_FIELDS = ["numero_fattura", "rgm", "parte", "data_emissione_fattura", "data_incasso", "imponibile"] as const;
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
const MAIN_COLOR = "#3aaeba";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);
  const url = new URL(request.url);
  const numero = url.searchParams.get("numero")?.trim()?.toLowerCase() ?? "";
  const rgm = url.searchParams.get("rgm")?.trim()?.toLowerCase() ?? "";
  const parte = url.searchParams.get("parte")?.trim()?.toLowerCase() ?? "";
  const data_da = url.searchParams.get("data_da")?.trim() ?? "";
  const data_a = url.searchParams.get("data_a")?.trim() ?? "";
  const sortField = SORT_FIELDS.includes(url.searchParams.get("sort") as (typeof SORT_FIELDS)[number])
    ? (url.searchParams.get("sort") as (typeof SORT_FIELDS)[number])
    : "data_emissione_fattura";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const perPageParam = url.searchParams.get("per_page");
  const perPage = PER_PAGE_OPTIONS.includes(Number(perPageParam) as (typeof PER_PAGE_OPTIONS)[number])
    ? (Number(perPageParam) as (typeof PER_PAGE_OPTIONS)[number])
    : 10;

  const fattureRaw = await pb.collection("fatture").getFullList({
    sort: "-data_emissione_fattura",
    expand: "mediazione,partecipazione,partecipazione.soggetto",
  });

  let rows = fattureRaw.map((f: Record<string, unknown>) => {
    const expand = f.expand as Record<string, unknown> | null;
    const mediazione = expand?.mediazione as Record<string, string> | null;
    const partecipazione = expand?.partecipazione as Record<string, { expand?: { soggetto?: Record<string, string> } }> | null;
    const s = partecipazione?.expand?.soggetto ?? null;
    const parteName = s
      ? (s.tipo === "Giuridica" ? s.ragione_sociale : [s.nome, s.cognome].filter(Boolean).join(" "))
      : "—";
    return {
      id: f.id,
      numero_fattura: f.numero_fattura ?? "—",
      mediazione_id: f.mediazione,
      rgm: mediazione?.rgm ?? "—",
      parte: parteName,
      data_emissione_fattura: f.data_emissione_fattura ?? null,
      data_incasso: f.data_incasso ?? null,
      imponibile: f.imponibile ?? null,
      nota: (f.nota as string) ?? "",
    };
  });

  if (numero) rows = rows.filter((r) => String(r.numero_fattura).toLowerCase().includes(numero));
  if (rgm) rows = rows.filter((r) => String(r.rgm).toLowerCase().includes(rgm));
  if (parte) rows = rows.filter((r) => String(r.parte).toLowerCase().includes(parte));
  if (data_da) rows = rows.filter((r) => r.data_emissione_fattura && String(r.data_emissione_fattura).slice(0, 10) >= data_da);
  if (data_a) rows = rows.filter((r) => r.data_emissione_fattura && String(r.data_emissione_fattura).slice(0, 10) <= data_a);

  rows.sort((a, b) => {
    let va: string | number | null = (a as Record<string, unknown>)[sortField] ?? "";
    let vb: string | number | null = (b as Record<string, unknown>)[sortField] ?? "";
    if (sortField === "imponibile") {
      va = Number(va) ?? 0;
      vb = Number(vb) ?? 0;
    } else if (sortField === "data_emissione_fattura" || sortField === "data_incasso") {
      va = va ? String(va) : "";
      vb = vb ? String(vb) : "";
    } else {
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
    }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return order === "asc" ? cmp : -cmp;
  });

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const fatture = rows.slice((page - 1) * perPage, page * perPage);

  return json({
    fatture,
    filters: { numero, rgm, parte, data_da, data_a },
    sortField,
    order,
    page,
    perPage,
    totalPages,
    totalItems,
  });
}

function buildPageUrl(searchParams: URLSearchParams, page: number): string {
  const next = new URLSearchParams(searchParams);
  next.set("page", String(page));
  return `/fatture?${next.toString()}`;
}

function buildPerPageUrl(searchParams: URLSearchParams, perPage: number): string {
  const next = new URLSearchParams(searchParams);
  next.set("per_page", String(perPage));
  next.set("page", "1");
  return `/fatture?${next.toString()}`;
}

export default function FattureList() {
  const { fatture, filters, sortField, order, page, perPage, totalPages, totalItems } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const headerBgSolid = "bg-base-200";
  const zebraEven = { backgroundColor: `${MAIN_COLOR}08` };
  const [expandedNota, setExpandedNota] = useState<Set<string>>(new Set());

  const paginationFooter = (
    <div className={`flex flex-wrap items-center justify-between gap-3 py-4 px-4 border-t border-base-200 ${headerBgSolid}`}>
      <div className="flex items-center gap-4 flex-nowrap">
        <p className="text-sm text-base-content/70">
          Pagina {page} di {totalPages} ({totalItems} fatture)
        </p>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap shrink-0">
          <span className="text-base-content/70">Per pagina:</span>
          <select
            value={perPage}
            onChange={(e) => navigate(buildPerPageUrl(searchParams, Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number]))}
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
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Link
            to={buildPageUrl(searchParams, page - 1)}
            className={`btn btn-sm btn-ghost btn-square ${page <= 1 ? "btn-disabled" : ""}`}
            aria-disabled={page <= 1}
            aria-label="Pagina precedente"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-1 px-2 flex-wrap">
            {(() => {
              const links: (number | "ellipsis")[] = [];
              if (totalPages <= 5) {
                for (let i = 1; i <= totalPages; i++) links.push(i);
              } else {
                links.push(1);
                if (page <= 3) {
                  links.push(2, 3, "ellipsis", totalPages);
                } else if (page >= totalPages - 2) {
                  links.push("ellipsis", totalPages - 2, totalPages - 1, totalPages);
                } else {
                  links.push("ellipsis", page - 1, page, page + 1, "ellipsis", totalPages);
                }
              }
              return links.map((item, i) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-base-content/50">…</span>
                ) : (
                  <Link
                    key={item}
                    to={buildPageUrl(searchParams, item)}
                    className={`btn btn-sm min-w-[2rem] ${item === page ? "btn-primary" : "btn-ghost"}`}
                  >
                    {item}
                  </Link>
                )
              );
            })()}
          </div>
          <Link
            to={buildPageUrl(searchParams, page + 1)}
            className={`btn btn-sm btn-ghost btn-square ${page >= totalPages ? "btn-disabled" : ""}`}
            aria-disabled={page >= totalPages}
            aria-label="Pagina successiva"
          >
            <ChevronRight className="h-5 w-5" />
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-semibold text-base-content shrink-0">Fatture</h1>
        <div className="flex items-center gap-4 flex-shrink-0">
          <button
            type="button"
            onClick={() => navigate("/fatture")}
            className="btn btn-soft btn-sm"
          >
            Azzera filtri
          </button>
        </div>
      </div>
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <FilterableTable
          id="fatture-filters-form"
          method="get"
          hiddenFields={{ sort: sortField, order, per_page: String(perPage), page: "1" }}
          className="overflow-visible"
          footer={paginationFooter}
        >
          <div>
            <table className="table table-sm w-full min-w-[1000px] [&_td]:align-top">
              <thead className={`sticky top-0 z-10 shadow-sm ${headerBgSolid}`}>
            <tr>
              <th className={`${filterableTableThClass} min-w-[100px]`}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="N. Fattura" field="numero_fattura" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
                <FilterTextInput name="numero" defaultValue={filters.numero} placeholder="N. fattura" />
              </th>
              <th className={`${filterableTableThClass} min-w-[100px]`}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Mediazione" field="rgm" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
                <FilterTextInput name="rgm" defaultValue={filters.rgm} placeholder="RGM" />
              </th>
              <th className={filterableTableThClass}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Parte" field="parte" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
                <FilterTextInput name="parte" defaultValue={filters.parte} placeholder="Parte" />
              </th>
              <th className={`${filterableTableThClass} min-w-[200px]`}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Data emissione" field="data_emissione_fattura" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
                <FilterDateRange nameFrom="data_da" nameTo="data_a" valueFrom={filters.data_da} valueTo={filters.data_a} />
              </th>
              <th className={filterableTableThClass}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Data incasso" field="data_incasso" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
              </th>
              <th className={filterableTableThClass}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Imponibile" field="imponibile" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
              </th>
              <th className={`${filterableTableThClass} min-w-[220px]`}>
                <div className={filterableTableHeaderLabelClass}>Nota</div>
              </th>
              <th
                className={`${filterableTableThClass} w-[100px] shrink-0 sticky right-0 z-20 border-l border-base-200 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)] ${headerBgSolid}`}
                style={{ right: "-2px" }}
              >
                <div className={filterableTableHeaderLabelClass}>Azioni</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {fatture.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-base-content/70 py-12">
                  Nessuna fattura trovata.
                </td>
              </tr>
            ) : (
              fatture.map((f, idx) => (
                <tr key={f.id} className="hover" style={idx % 2 === 1 ? zebraEven : undefined}>
                  <td className="py-2 font-medium">{f.numero_fattura}</td>
                  <td className="py-2">
                    <Link to={`/mediazioni/${f.mediazione_id}?tab=fatture`} className="link link-hover">
                      {f.rgm}
                    </Link>
                  </td>
                  <td className="py-2">{f.parte}</td>
                  <td className="py-2 whitespace-nowrap">
                    {f.data_emissione_fattura ? new Date(f.data_emissione_fattura).toLocaleDateString("it-IT") : "—"}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    {f.data_incasso ? new Date(f.data_incasso).toLocaleDateString("it-IT") : "—"}
                  </td>
                  <td className="py-2">{f.imponibile != null ? `€ ${Number(f.imponibile)}` : "—"}</td>
                  <td className="py-2 min-w-[220px] max-w-[280px] align-top">
                    {expandedNota.has(f.id) ? (
                      <span className="block whitespace-pre-wrap text-sm">{f.nota || "—"}</span>
                    ) : (
                      <span className="block truncate">{f.nota || "—"}</span>
                    )}
                  </td>
                  <td
                    className={`py-2 shrink-0 sticky right-0 z-10 border-l border-base-200 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)] align-top ${
                      idx % 2 === 1 ? "bg-base-200" : "bg-base-100"
                    }`}
                    style={{ right: "-2px" }}
                  >
                    <div className="flex items-start gap-1">
                      {f.nota && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedNota((prev) => {
                              const next = new Set(prev);
                              if (next.has(f.id)) next.delete(f.id);
                              else next.add(f.id);
                              return next;
                            })
                          }
                          className="btn btn-ghost btn-sm btn-square min-h-0 h-8 w-8 p-0 shrink-0"
                          aria-label={expandedNota.has(f.id) ? "Comprimi nota" : "Espandi nota"}
                        >
                          {expandedNota.has(f.id) ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <Link
                        to={`/mediazioni/${f.mediazione_id}?tab=fatture`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm btn-square min-h-0 h-8 w-8 p-0"
                        title="Visualizza mediazione"
                        aria-label="Visualizza mediazione"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
          </div>
        </FilterableTable>
      </div>
    </div>
  );
}
