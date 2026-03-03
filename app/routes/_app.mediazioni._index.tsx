import { useState, useRef, useEffect } from "react";
import { Link, useLoaderData, useSearchParams, useNavigate, useFetcher } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Mediazioni" }];
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import {
  FilterableTable,
  FilterTextInput,
  FilterSelect,
  FilterDateRange,
  SortLink,
  filterableTableHeadClass,
  filterableTableThClass,
  filterableTableHeaderLabelClass,
} from "~/components/data-table";
import { ExportMediazioniDialog } from "~/components/export-mediazioni-dialog";
import { Eye, MoreVertical, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";

const ESITO_OPTIONS = ["Accordo", "Mancato accordo", "Improcedibile", "Chiusa d'ufficio", "Nessuna risposta"].map((label) => ({ value: label, label }));
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
const SORT_FIELDS = ["rgm", "oggetto", "data_protocollo", "data_chiusura", "esito_finale", "modalita_mediazione", "competenza", "mediatore_name"] as const;
const MAIN_COLOR = "#3aaeba";

function stripHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, "").trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const role = getCurrentRole(user);
  const canCreate = role === "admin" || role === "manager";
  const canDelete = role === "admin" || role === "manager";
  const url = new URL(request.url);

  const rgm = url.searchParams.get("rgm")?.trim() ?? "";
  const oggetto = url.searchParams.get("oggetto")?.trim() ?? "";
  const valore = url.searchParams.get("valore")?.trim() ?? "";
  const esito = url.searchParams.get("esito")?.trim() ?? "";
  const data_da = url.searchParams.get("data_da")?.trim() ?? "";
  const data_a = url.searchParams.get("data_a")?.trim() ?? "";
  const data_chiusura_da = url.searchParams.get("data_chiusura_da")?.trim() ?? "";
  const data_chiusura_a = url.searchParams.get("data_chiusura_a")?.trim() ?? "";
  const modalita = url.searchParams.get("modalita")?.trim() ?? "";
  const istante = url.searchParams.get("istante")?.trim() ?? "";
  const chiamato = url.searchParams.get("chiamato")?.trim() ?? "";
  const avvocato = url.searchParams.get("avvocato")?.trim() ?? "";
  const competenza = url.searchParams.get("competenza")?.trim() ?? "";
  const nota = url.searchParams.get("nota")?.trim() ?? "";
  const mediatore = url.searchParams.get("mediatore")?.trim() ?? "";

  const sortField = SORT_FIELDS.includes(url.searchParams.get("sort") as (typeof SORT_FIELDS)[number])
    ? (url.searchParams.get("sort") as (typeof SORT_FIELDS)[number])
    : "data_protocollo";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
  const sort = order === "desc" ? `-${sortField}` : sortField;
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const perPageParam = url.searchParams.get("per_page");
  const perPage = PER_PAGE_OPTIONS.includes(Number(perPageParam) as (typeof PER_PAGE_OPTIONS)[number])
    ? (Number(perPageParam) as (typeof PER_PAGE_OPTIONS)[number])
    : 10;

  const filterParts: string[] = [];
  if (role === "mediatore") filterParts.push(`mediatore = "${user.id}"`);
  if (rgm) filterParts.push(pb.filter("rgm ~ {:rgm}", { rgm }));
  if (oggetto) filterParts.push(pb.filter("oggetto ~ {:oggetto}", { oggetto }));
  if (valore) filterParts.push(pb.filter("valore ~ {:valore}", { valore }));
  if (esito) filterParts.push(`esito_finale = "${esito}"`);
  if (data_da) filterParts.push(`data_protocollo >= "${data_da}"`);
  if (data_a) filterParts.push(`data_protocollo <= "${data_a}"`);
  if (data_chiusura_da) filterParts.push(`data_chiusura >= "${data_chiusura_da}"`);
  if (data_chiusura_a) filterParts.push(`data_chiusura <= "${data_chiusura_a}"`);
  if (modalita) filterParts.push(pb.filter("modalita_mediazione ~ {:modalita}", { modalita }));
  if (istante) filterParts.push(pb.filter("istanti_testo ~ {:istante}", { istante }));
  if (chiamato) filterParts.push(pb.filter("chiamati_testo ~ {:chiamato}", { chiamato }));
  if (avvocato) filterParts.push(pb.filter("avvocati_testo ~ {:avvocato}", { avvocato }));
  if (competenza) filterParts.push(pb.filter("competenza ~ {:competenza}", { competenza }));
  if (nota) filterParts.push(pb.filter("nota ~ {:nota}", { nota }));
  if (mediatore) filterParts.push(pb.filter("mediatore_name ~ {:mediatore}", { mediatore }));
  const filter = filterParts.length > 0 ? filterParts.join(" && ") : undefined;

  const [result, modalitaList] = await Promise.all([
    pb.collection("mediazioni_view").getList(page, perPage, {
      sort,
      ...(filter && { filter }),
    }),
    pb
      .collection("modalita_opzioni")
      .getFullList({ filter: "attivo = true", sort: "nome" })
      .catch(() => []),
  ]);

  const mediazioni = result.items.map((m) => ({
    id: String(m.id),
    rgm: String(m.rgm ?? "—"),
    oggetto: String(m.oggetto ?? "—"),
    valore: String(m.valore ?? "—"),
    modalita_mediazione: String(m.modalita_mediazione ?? "—"),
    esito_finale: String(m.esito_finale ?? "—"),
    data_protocollo: m.data_protocollo ? String(m.data_protocollo) : null,
    data_chiusura: m.data_chiusura ? String(m.data_chiusura) : null,
    mediatore_name: String(m.mediatore_name ?? "—"),
    istanti: m.istanti_testo ? String(m.istanti_testo) : null,
    chiamati: m.chiamati_testo ? String(m.chiamati_testo) : null,
    avvocati: m.avvocati_testo ? String(m.avvocati_testo) : null,
    competenza: String(m.competenza ?? "—"),
    nota: m.nota ? stripHtml(String(m.nota)) : "—",
  }));

  const modalitaOptions = (modalitaList as { nome: string }[]).map((o) => ({ value: o.nome, label: o.nome }));

  return json({
    mediazioni,
    canCreate,
    canDelete,
    filters: {
      rgm,
      oggetto,
      valore,
      esito,
      data_da,
      data_a,
      data_chiusura_da,
      data_chiusura_a,
      modalita,
      istante,
      chiamato,
      avvocato,
      competenza,
      nota,
      mediatore,
    },
    sortField,
    order,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil((result.totalItems ?? 0) / perPage)),
    totalItems: result.totalItems ?? 0,
    modalitaOptions,
  });
}

function buildPageUrl(searchParams: URLSearchParams, page: number): string {
  const next = new URLSearchParams(searchParams);
  next.set("page", String(page));
  return `/mediazioni?${next.toString()}`;
}

function buildPerPageUrl(searchParams: URLSearchParams, perPage: number): string {
  const next = new URLSearchParams(searchParams);
  next.set("per_page", String(perPage));
  next.set("page", "1");
  return `/mediazioni?${next.toString()}`;
}

function RowActionsDropdown({
  mediazioneId,
  canDelete,
  onDelete,
}: {
  mediazioneId: string;
  canDelete: boolean;
  onDelete: (id: string) => void;
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

  if (!canDelete) return null;

  return (
    <div className="relative" ref={ref}>
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
        <div className="dropdown-content z-20 mt-1 p-1 shadow-lg bg-base-100 rounded-lg border border-base-200 min-w-[160px] absolute right-0">
          <button
            type="button"
            onClick={() => {
              if (confirm("Sei sicuro di voler eliminare questa mediazione?")) {
                onDelete(mediazioneId);
                setOpen(false);
              }
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-error hover:bg-error/10 rounded-md"
          >
            Elimina mediazione
          </button>
        </div>
      )}
    </div>
  );
}

function filtersRecordFromLoader(filters: {
  rgm: string;
  oggetto: string;
  valore: string;
  esito: string;
  data_da: string;
  data_a: string;
  data_chiusura_da: string;
  data_chiusura_a: string;
  modalita: string;
  istante: string;
  chiamato: string;
  avvocato: string;
  competenza: string;
  nota: string;
  mediatore: string;
}): Record<string, string> {
  return {
    rgm: filters.rgm,
    oggetto: filters.oggetto,
    valore: filters.valore,
    esito: filters.esito,
    data_da: filters.data_da,
    data_a: filters.data_a,
    data_chiusura_da: filters.data_chiusura_da,
    data_chiusura_a: filters.data_chiusura_a,
    modalita: filters.modalita,
    istante: filters.istante,
    chiamato: filters.chiamato,
    avvocato: filters.avvocato,
    competenza: filters.competenza,
    nota: filters.nota,
    mediatore: filters.mediatore,
  };
}

export default function MediazioniList() {
  const { mediazioni, filters, sortField, order, page, perPage, totalPages, totalItems, modalitaOptions, canDelete, canCreate } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const hiddenFields: Record<string, string> = { sort: sortField, order, per_page: String(perPage), page: "1" };

  function handleDelete(id: string) {
    fetcher.submit(
      { _action: "delete_mediazione" },
      { method: "post", action: `/mediazioni/${id}` }
    );
  }

  const cellTruncate = "align-top";
  const headerBgSolid = "bg-base-200";
  const [expandedNota, setExpandedNota] = useState<Set<string>>(new Set());
  const zebraEven = { backgroundColor: `${MAIN_COLOR}08` };

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-semibold text-base-content shrink-0">Mediazioni</h1>
        <div className="flex items-center gap-4 flex-shrink-0">
          <button
            type="button"
            onClick={() => navigate("/mediazioni")}
            className="btn btn-soft btn-sm"
          >
            Azzera filtri
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExportDialogOpen(true);
            }}
            className="btn btn-warning btn-sm"
          >
            Esporta
          </button>
          {canCreate && (
            <>
              <Link to="/mediazioni/import" className="btn btn-ghost btn-sm">
                Importa mediazioni
              </Link>
              <span className="hidden sm:inline w-px h-6 bg-base-300 rounded" aria-hidden />
              <Link to="/mediazioni/new" className="btn btn-primary btn-sm">
                Nuova mediazione
              </Link>
            </>
          )}
        </div>
      </div>
      <ExportMediazioniDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        filters={filtersRecordFromLoader(filters)}
        sortField={sortField}
        order={order}
      />
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <FilterableTable
        id="mediazioni-filters-form"
        method="get"
        hiddenFields={hiddenFields}
        className="overflow-visible"
        footer={
          <div
            className={`flex flex-wrap items-center justify-between gap-3 py-3 px-4 border-t border-base-200 ${headerBgSolid}`}
          >
            <div className="flex items-center gap-4 flex-nowrap">
              <p className="text-sm text-base-content/70">
                Pagina {page} di {totalPages} ({totalItems} mediazioni)
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
        }
      >
        <div>
          <table className="table table-sm w-full min-w-[1500px] [&_td]:align-top">
            <thead className={`sticky top-0 z-10 shadow-sm ${headerBgSolid}`}>
              <tr>
                <th className={`${filterableTableThClass} min-w-[90px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="RGM" field="rgm" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterTextInput name="rgm" defaultValue={filters.rgm} placeholder="Cerca RGM" />
                </th>
                <th className={`${filterableTableThClass} min-w-[200px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="Data protocollo" field="data_protocollo" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterDateRange nameFrom="data_da" nameTo="data_a" valueFrom={filters.data_da} valueTo={filters.data_a} />
                </th>
                <th className={`${filterableTableThClass} min-w-[120px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="Mediatore" field="mediatore_name" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterTextInput name="mediatore" defaultValue={filters.mediatore} placeholder="Cerca mediatore" />
                </th>
                <th className={`${filterableTableThClass} min-w-[180px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="Oggetto" field="oggetto" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterTextInput name="oggetto" defaultValue={filters.oggetto} placeholder="Cerca oggetto" />
                </th>
                <th className={`${filterableTableThClass} min-w-[140px]`}>
                  <div className={filterableTableHeaderLabelClass}>Istanti</div>
                  <FilterTextInput name="istante" defaultValue={filters.istante} placeholder="Cerca istante..." />
                </th>
                <th className={`${filterableTableThClass} min-w-[140px]`}>
                  <div className={filterableTableHeaderLabelClass}>Chiamati</div>
                  <FilterTextInput name="chiamato" defaultValue={filters.chiamato} placeholder="Cerca chiamato..." />
                </th>
                <th className={`${filterableTableThClass} min-w-[140px]`}>
                  <div className={filterableTableHeaderLabelClass}>Avvocati</div>
                  <FilterTextInput name="avvocato" defaultValue={filters.avvocato} placeholder="Cerca avvocato..." />
                </th>
                <th className={`${filterableTableThClass} min-w-[120px]`}>
                  <div className={filterableTableHeaderLabelClass}>Competenza</div>
                  <FilterTextInput name="competenza" defaultValue={filters.competenza} placeholder="Cerca competenza" />
                </th>
                <th className={`${filterableTableThClass} min-w-[120px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="Modalità" field="modalita_mediazione" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterSelect name="modalita" defaultValue={filters.modalita} options={modalitaOptions} emptyLabel="Tutte" />
                </th>
                <th className={`${filterableTableThClass} min-w-[130px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="Esito" field="esito_finale" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterSelect name="esito" defaultValue={filters.esito} options={ESITO_OPTIONS} emptyLabel="Tutti" />
                </th>
                <th className={`${filterableTableThClass} min-w-[200px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="Data chiusura" field="data_chiusura" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterDateRange
                    nameFrom="data_chiusura_da"
                    nameTo="data_chiusura_a"
                    valueFrom={filters.data_chiusura_da}
                    valueTo={filters.data_chiusura_a}
                  />
                </th>
                <th className={`${filterableTableThClass} min-w-[220px]`}>
                  <div className={filterableTableHeaderLabelClass}>Nota</div>
                  <FilterTextInput name="nota" defaultValue={filters.nota} placeholder="Cerca nota" />
                </th>
                <th
                  className={`${filterableTableThClass} w-[100px] shrink-0 sticky top-0 right-0 z-20 border-l border-base-200 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)] ${headerBgSolid} text-right`}
                  style={{ right: "-2px" }}
                >
                  <div className={filterableTableHeaderLabelClass}>Azioni</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {mediazioni.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center text-base-content/70 py-12">
                    Nessuna mediazione trovata.
                  </td>
                </tr>
              ) : (
                mediazioni.map((m, idx) => (
                  <tr key={m.id} className="hover" style={idx % 2 === 1 ? zebraEven : undefined}>
                    <td className="py-2">
                      <span className="font-medium truncate block max-w-[90px]">{m.rgm}</span>
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {m.data_protocollo ? new Date(m.data_protocollo).toLocaleDateString("it-IT") : "—"}
                    </td>
                    <td className={`py-2 max-w-[140px] ${cellTruncate}`}>
                      <span className="block truncate">{m.mediatore_name}</span>
                    </td>
                    <td className={`py-2 max-w-[200px] ${cellTruncate}`}>
                      <span className="block truncate">{m.oggetto}</span>
                    </td>
                    <td className={`py-2 max-w-[160px] ${cellTruncate}`}>
                      {m.istanti ? (
                        m.istanti.split(",").map((name, i) => (
                          <div key={i} className="truncate">
                            {name.trim()}
                          </div>
                        ))
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`py-2 max-w-[160px] ${cellTruncate}`}>
                      {m.chiamati ? (
                        m.chiamati.split(",").map((name, i) => (
                          <div key={i} className="truncate">
                            {name.trim()}
                          </div>
                        ))
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`py-2 max-w-[160px] ${cellTruncate}`}>
                      <span className="block truncate">{m.avvocati ?? "—"}</span>
                    </td>
                    <td className={`py-2 max-w-[120px] ${cellTruncate}`}>
                      <span className="block truncate">{m.competenza}</span>
                    </td>
                    <td className="py-2 whitespace-nowrap">{m.modalita_mediazione}</td>
                    <td className="py-2 whitespace-nowrap">{m.esito_finale}</td>
                    <td className="py-2 whitespace-nowrap">
                      {m.data_chiusura ? new Date(m.data_chiusura).toLocaleDateString("it-IT") : "—"}
                    </td>
                    <td className={`py-2 min-w-[220px] max-w-[280px] align-top ${cellTruncate}`}>
                      {expandedNota.has(m.id) ? (
                        <span className="block whitespace-pre-wrap text-sm">{m.nota}</span>
                      ) : (
                        <span className="block truncate">{m.nota}</span>
                      )}
                    </td>
                    <td
                      className={`py-2 shrink-0 sticky right-0 z-10 border-l border-base-200 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)] align-top ${
                        idx % 2 === 1 ? "bg-base-200" : "bg-base-100"
                      }`}
                      style={{ right: "-2px" }}
                    >
                      <div className="flex items-start gap-1 justify-end">
                        {m.nota && m.nota !== "—" && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedNota((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.id)) next.delete(m.id);
                                else next.add(m.id);
                                return next;
                              })
                            }
                            className="btn btn-ghost btn-sm btn-square min-h-0 h-8 w-8 p-0 shrink-0"
                            aria-label={expandedNota.has(m.id) ? "Comprimi nota" : "Espandi nota"}
                          >
                            {expandedNota.has(m.id) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        )}
                        <Link
                          to={`/mediazioni/${m.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm btn-square min-h-0 h-8 w-8 p-0"
                          title="Visualizza"
                          aria-label="Visualizza mediazione"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        <RowActionsDropdown mediazioneId={m.id} canDelete={canDelete} onDelete={handleDelete} />
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
