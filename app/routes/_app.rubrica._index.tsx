import { Link, useLoaderData, useSearchParams, useNavigate, useFetcher, useActionData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
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
import { ChevronLeft, ChevronRight, Eye, MoreVertical } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { UnisciRubricaDialog } from "~/components/unisci-rubrica-dialog";
import type { RubricaItem } from "~/components/unisci-rubrica-dialog";
import {
  buildRubricaRows,
  filterRubricaRows,
  parseRubricaFilters,
  sortRubricaRows,
  type RubricaKind,
  type RubricaRow,
} from "~/lib/rubrica.server";

const MAIN_COLOR = "#3aaeba";
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
const SORT_FIELDS = [
  "tipoLabel",
  "display",
  "codice_fiscale",
  "comune",
  "provincia",
  "cap",
  "email_pec",
  "telefono",
] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);
  const url = new URL(request.url);
  const filters = parseRubricaFilters(url);
  const sortParam = url.searchParams.get("sort") || "display";
  const sort = (SORT_FIELDS as readonly string[]).includes(sortParam) ? sortParam : "display";
  const order = url.searchParams.get("order") === "desc" ? "desc" : "asc";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(url.searchParams.get("per_page")) as (typeof PER_PAGE_OPTIONS)[number])
    ? (Number(url.searchParams.get("per_page")) as (typeof PER_PAGE_OPTIONS)[number])
    : 25;

  const [soggettiResp, avvocatiResp] = await Promise.all([
    pb.collection("soggetti").getFullList({ sort: "nome,cognome,ragione_sociale" }),
    pb.collection("avvocati").getFullList({ sort: "cognome,nome" }),
  ]);

  const allRows = buildRubricaRows(
    soggettiResp as Record<string, unknown>[],
    avvocatiResp as Record<string, unknown>[],
  );
  const filtered = sortRubricaRows(filterRubricaRows(allRows, filters), sort, order);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const items = filtered.slice((page - 1) * perPage, page * perPage);

  const allSoggettiForMerge: RubricaItem[] = allRows
    .filter((r) => r.kind === "soggetti")
    .map((r) => ({
      id: r.id,
      display: r.display,
      codiceFiscale: r.codice_fiscale || undefined,
    }));
  const allAvvocatiForMerge: RubricaItem[] = allRows
    .filter((r) => r.kind === "avvocati")
    .map((r) => ({ id: r.id, display: r.display }));

  return json({
    items,
    allSoggettiForMerge,
    allAvvocatiForMerge,
    filters,
    sort,
    order,
    page,
    perPage,
    totalPages,
    totalItems,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete_soggetto") {
    const id = String(formData.get("id") ?? "").trim();
    if (!id) return json({ error: "ID mancante" }, { status: 400 });
    const used = await pb.collection("partecipazioni").getFullList({ filter: `soggetto = "${id}"`, limit: 1 });
    if (used.length > 0) {
      return json({ error: "Impossibile eliminare: il soggetto è usato in una o più mediazioni." }, { status: 400 });
    }
    await pb.collection("soggetti").delete(id);
    return redirect("/rubrica");
  }

  if (intent === "delete_avvocato") {
    const id = String(formData.get("id") ?? "").trim();
    if (!id) return json({ error: "ID mancante" }, { status: 400 });
    const used = await pb.collection("partecipazioni").getFullList({ filter: `avvocati ?= "${id}"`, limit: 1 });
    if (used.length > 0) {
      return json({ error: "Impossibile eliminare: l'avvocato è usato in una o più mediazioni." }, { status: 400 });
    }
    await pb.collection("avvocati").delete(id);
    return redirect("/rubrica");
  }

  if (intent === "merge_soggetto") {
    const sourceId = String(formData.get("source_id") ?? "").trim();
    const targetId = String(formData.get("target_id") ?? "").trim();
    if (!sourceId || !targetId || sourceId === targetId) {
      return json({ error: "Sorgente e destinazione non validi." }, { status: 400 });
    }
    const partecipazioni = await pb.collection("partecipazioni").getFullList({
      filter: `soggetto = "${sourceId}"`,
    });
    for (const p of partecipazioni as Record<string, unknown>[]) {
      await pb.collection("partecipazioni").update(p.id as string, { soggetto: targetId });
    }
    await pb.collection("soggetti").delete(sourceId);
    return redirect("/rubrica");
  }

  if (intent === "merge_avvocato") {
    const sourceId = String(formData.get("source_id") ?? "").trim();
    const targetId = String(formData.get("target_id") ?? "").trim();
    if (!sourceId || !targetId || sourceId === targetId) {
      return json({ error: "Sorgente e destinazione non validi." }, { status: 400 });
    }
    const partecipazioni = await pb.collection("partecipazioni").getFullList({
      filter: `avvocati ?= "${sourceId}"`,
    });
    for (const p of partecipazioni as Record<string, unknown>[]) {
      const avvocati = (Array.isArray(p.avvocati) ? p.avvocati : [p.avvocati].filter(Boolean)) as string[];
      const updated = avvocati
        .map((aid) => (aid === sourceId ? targetId : aid))
        .filter((aid, i, arr) => arr.indexOf(aid) === i);
      await pb.collection("partecipazioni").update(p.id as string, { avvocati: updated });
    }
    await pb.collection("avvocati").delete(sourceId);
    return redirect("/rubrica");
  }

  return json({ error: "Azione non riconosciuta" }, { status: 400 });
}

function buildPageUrl(basePath: string, searchParams: URLSearchParams, page: number): string {
  const next = new URLSearchParams(searchParams);
  next.set("page", String(page));
  return `${basePath}?${next.toString()}`;
}

function buildPerPageUrl(basePath: string, searchParams: URLSearchParams, perPage: number): string {
  const next = new URLSearchParams(searchParams);
  next.set("per_page", String(perPage));
  next.set("page", "1");
  return `${basePath}?${next.toString()}`;
}

function RowActionsDropdown({
  kind,
  id,
  display,
  onUnisci,
  onDelete,
}: {
  kind: RubricaKind;
  id: string;
  display: string;
  onUnisci: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [open]);

  const detailUrl = kind === "soggetti" ? `/rubrica/soggetti/${id}` : `/rubrica/avvocati/${id}`;

  return (
    <div className="relative flex items-center gap-1" ref={ref}>
      <Link
        to={detailUrl}
        className="btn btn-ghost btn-sm btn-square min-h-0 h-8 w-8 p-0"
        aria-label="Visualizza"
      >
        <Eye className="h-4 w-4" />
      </Link>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost btn-sm btn-square min-h-0 h-8 w-8 p-0"
        aria-label="Azioni"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="dropdown-content z-20 mt-1 p-1 shadow-lg bg-base-100 rounded-lg border border-base-200 min-w-[160px] absolute right-0 top-full">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onUnisci();
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-base-200 rounded-md"
          >
            Unisci
          </button>
          <button
            type="button"
            onClick={() => {
              const msg =
                kind === "soggetti"
                  ? "Eliminare questo soggetto dalla rubrica?"
                  : "Eliminare questo avvocato dalla rubrica?";
              if (confirm(msg)) {
                setOpen(false);
                onDelete();
              }
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-error hover:bg-error/10 rounded-md"
          >
            Elimina
          </button>
        </div>
      )}
    </div>
  );
}

function tipoBadgeClass(tipo: RubricaRow["tipo"]) {
  if (tipo === "fisica") return "bg-info/15 text-info border-info/30";
  if (tipo === "giuridica") return "bg-warning/15 text-warning border-warning/30";
  return "bg-success/15 text-success border-success/30";
}

const TIPO_SHORT: Record<RubricaRow["tipo"], string> = {
  fisica: "Fisica",
  giuridica: "Giuridica",
  avvocato: "Avvocato",
};

export default function RubricaIndex() {
  const {
    items,
    allSoggettiForMerge,
    allAvvocatiForMerge,
    filters,
    sort,
    order,
    page,
    perPage,
    totalPages,
    totalItems,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();

  const [mergeState, setMergeState] = useState<{
    kind: RubricaKind;
    sourceId: string;
    sourceDisplay: string;
  } | null>(null);

  const isSubmittingMerge = fetcher.state !== "idle";
  const headerBgSolid = "bg-base-200";
  const zebraEven = { backgroundColor: `${MAIN_COLOR}08` };

  const sortLinkProps = {
    basePath: "/rubrica",
    sortParam: "sort" as const,
    orderParam: "order" as const,
    currentSort: sort,
    currentOrder: order,
    searchParams,
  };

  const paginationFooter = (
    <div className={`flex flex-wrap items-center justify-between gap-3 py-4 px-4 border-t border-base-200 ${headerBgSolid}`}>
      <div className="flex items-center gap-4 flex-nowrap">
        <p className="text-sm text-base-content/70">
          Pagina {page} di {totalPages} ({totalItems} voci)
        </p>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap shrink-0">
          <span className="text-base-content/70">Per pagina:</span>
          <select
            value={perPage}
            onChange={(e) =>
              navigate(
                buildPerPageUrl(
                  "/rubrica",
                  searchParams,
                  Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number],
                ),
              )
            }
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
            to={buildPageUrl("/rubrica", searchParams, page - 1)}
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
              } else if (page <= 3) {
                links.push(1, 2, 3, "ellipsis", totalPages);
              } else if (page >= totalPages - 2) {
                links.push(1, "ellipsis", totalPages - 2, totalPages - 1, totalPages);
              } else {
                links.push(1, "ellipsis", page - 1, page, page + 1, "ellipsis", totalPages);
              }
              return links.map((item, i) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-base-content/50">
                    …
                  </span>
                ) : (
                  <Link
                    key={item}
                    to={buildPageUrl("/rubrica", searchParams, item)}
                    className={`btn btn-sm min-w-[2rem] ${item === page ? "btn-primary" : "btn-ghost"}`}
                  >
                    {item}
                  </Link>
                ),
              );
            })()}
          </div>
          <Link
            to={buildPageUrl("/rubrica", searchParams, page + 1)}
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

  const handleMergeConfirm = (targetId: string) => {
    if (!mergeState) return;
    const intent = mergeState.kind === "soggetti" ? "merge_soggetto" : "merge_avvocato";
    fetcher.submit(
      { intent, source_id: mergeState.sourceId, target_id: targetId },
      { method: "post" },
    );
    setMergeState(null);
  };

  return (
    <div>
      {actionData && "error" in actionData && (
        <div className="mb-4 p-3 rounded-lg bg-error/10 text-error text-sm" role="alert">
          {actionData.error}
        </div>
      )}
      <UnisciRubricaDialog
        isOpen={!!mergeState}
        onClose={() => setMergeState(null)}
        kind={mergeState?.kind ?? "soggetti"}
        sourceId={mergeState?.sourceId ?? ""}
        sourceDisplay={mergeState?.sourceDisplay ?? ""}
        items={mergeState?.kind === "avvocati" ? allAvvocatiForMerge : allSoggettiForMerge}
        onConfirm={handleMergeConfirm}
        isSubmitting={isSubmittingMerge}
      />

      <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
        <button type="button" onClick={() => navigate("/rubrica")} className="btn btn-soft btn-sm">
          Azzera filtri
        </button>
      </div>

      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <FilterableTable
          id="rubrica-filters-form"
          method="get"
          hiddenFields={{
            sort,
            order,
            page: "1",
            per_page: String(perPage),
          }}
          footer={paginationFooter}
        >
          <div>
            <table className="table table-sm w-full min-w-[1100px] table-fixed">
              <thead className={`sticky top-0 z-10 shadow-sm ${headerBgSolid}`}>
                <tr>
                  <th className={`${filterableTableThClass} w-[7.5rem]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Tipo" field="tipoLabel" {...sortLinkProps} />
                    </div>
                    <FilterSelect
                      name="tipo"
                      defaultValue={filters.tipo}
                      emptyLabel="Tutti"
                      options={[
                        { value: "fisica", label: "Fisica" },
                        { value: "giuridica", label: "Giuridica" },
                        { value: "avvocato", label: "Avvocato" },
                      ]}
                    />
                  </th>
                  <th className={`${filterableTableThClass} w-[16rem]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Nome / Ragione sociale" field="display" {...sortLinkProps} />
                    </div>
                    <FilterTextInput name="q" type="search" defaultValue={filters.q} placeholder="Cerca…" />
                  </th>
                  <th className={`${filterableTableThClass} w-[9rem]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="CF" field="codice_fiscale" {...sortLinkProps} />
                    </div>
                    <FilterTextInput name="cf" defaultValue={filters.cf} placeholder="CF" />
                  </th>
                  <th className={`${filterableTableThClass} w-[8rem]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Comune" field="comune" {...sortLinkProps} />
                    </div>
                    <FilterTextInput name="comune" defaultValue={filters.comune} placeholder="Comune" />
                  </th>
                  <th className={`${filterableTableThClass} w-[6rem]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Provincia" field="provincia" {...sortLinkProps} />
                    </div>
                    <FilterTextInput name="provincia" defaultValue={filters.provincia} placeholder="Provincia" />
                  </th>
                  <th className={`${filterableTableThClass} w-[5rem]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="CAP" field="cap" {...sortLinkProps} />
                    </div>
                    <FilterTextInput name="cap" defaultValue={filters.cap} placeholder="CAP" />
                  </th>
                  <th className={`${filterableTableThClass} w-[12rem]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Email / PEC" field="email_pec" {...sortLinkProps} />
                    </div>
                    <FilterTextInput name="email_pec" defaultValue={filters.email_pec} placeholder="Email o PEC" />
                  </th>
                  <th className={`${filterableTableThClass} w-[9rem]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Telefono / Foro" field="telefono" {...sortLinkProps} />
                    </div>
                    <FilterTextInput name="telefono" defaultValue={filters.telefono} placeholder="Telefono o foro" />
                  </th>
                  <th className={`${filterableTableThClass} w-[5.5rem]`}>
                    <div className={filterableTableHeaderLabelClass}>Azioni</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-base-content/70 py-12">
                      Nessuna voce trovata in rubrica.
                    </td>
                  </tr>
                ) : (
                  items.map((row, idx) => {
                    const detailUrl =
                      row.kind === "soggetti"
                        ? `/rubrica/soggetti/${row.id}`
                        : `/rubrica/avvocati/${row.id}`;
                    const telefonoForo = [row.telefono, row.foro].filter(Boolean).join(" · ") || "—";
                    return (
                      <tr key={`${row.kind}-${row.id}`} className="hover" style={idx % 2 === 1 ? zebraEven : undefined}>
                        <td className="py-2 align-middle whitespace-nowrap overflow-hidden">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tipoBadgeClass(row.tipo)}`}
                            title={row.tipoLabel}
                          >
                            {TIPO_SHORT[row.tipo]}
                          </span>
                        </td>
                        <td className="py-2 align-middle overflow-hidden">
                          <Link to={detailUrl} className="link link-hover font-medium block truncate" title={row.display}>
                            {row.display}
                          </Link>
                        </td>
                        <td className="py-2 align-middle truncate" title={row.codice_fiscale || ""}>
                          {row.codice_fiscale || "—"}
                        </td>
                        <td className="py-2 align-middle truncate" title={row.comune || ""}>
                          {row.comune || "—"}
                        </td>
                        <td className="py-2 align-middle truncate" title={row.provincia || ""}>
                          {row.provincia || "—"}
                        </td>
                        <td className="py-2 align-middle truncate" title={row.cap || ""}>
                          {row.cap || "—"}
                        </td>
                        <td className="py-2 align-middle truncate" title={row.email_pec || ""}>
                          {row.email_pec || "—"}
                        </td>
                        <td className="py-2 align-middle truncate" title={telefonoForo}>
                          {telefonoForo}
                        </td>
                        <td className="py-2 align-middle whitespace-nowrap">
                          <RowActionsDropdown
                            kind={row.kind}
                            id={row.id}
                            display={row.display}
                            onUnisci={() =>
                              setMergeState({
                                kind: row.kind,
                                sourceId: row.id,
                                sourceDisplay: row.display,
                              })
                            }
                            onDelete={() =>
                              fetcher.submit(
                                {
                                  intent: row.kind === "soggetti" ? "delete_soggetto" : "delete_avvocato",
                                  id: row.id,
                                },
                                { method: "post" },
                              )
                            }
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </FilterableTable>
      </div>
    </div>
  );
}
