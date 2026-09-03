import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useLoaderData, useSearchParams, useNavigate, useFetcher } from "@remix-run/react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Mediazioni" }];
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { callRiconciliamoApi } from "~/lib/riconciliamo-api.server";
import {
  FilterableTable,
  FilterTextInput,
  FilterSelect,
  FilterDateRange,
  SortLink,
  filterableTableThClass,
  filterableTableHeaderLabelClass,
} from "~/components/data-table";
import { ExportMediazioniDialog } from "~/components/export-mediazioni-dialog";
import { ESITO_FINALE_FILTER_OPTIONS } from "~/lib/esito-finale";
import { Eye, Trash2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
const SORT_FIELDS = ["rgm", "oggetto", "data_deposito", "data_protocollo", "data_chiusura", "esito_finale", "modalita_mediazione", "competenza", "mediatore_name", "stato", "data_assegnazione"] as const;
const TABS = ["da-assegnare", "da-pianificare", "da-notificare", "aperte", "chiuse"] as const;
type Tab = (typeof TABS)[number];

/** Chiusa = data chiusura + esito valorizzato (e non "In corso"). */
const FILTER_CHIUSE =
  `(data_chiusura != "" && data_chiusura != null && esito_finale != "" && esito_finale != null && esito_finale != "In corso")`;
const FILTER_APERTE =
  `(data_chiusura = "" || data_chiusura = null || esito_finale = "" || esito_finale = null || esito_finale = "In corso")`;

function stripHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, "").trim();
}

function tabBaseFilter(tab: Tab): string {
  switch (tab) {
    case "da-assegnare":
      return `${FILTER_APERTE} && stato = "registrata"`;
    case "da-pianificare":
      return `${FILTER_APERTE} && stato = "assegnata"`;
    case "da-notificare":
      return `${FILTER_APERTE} && (stato = "da_notificare" || stato = "pianificata")`;
    case "aperte":
      return `${FILTER_APERTE} && stato = "aperta"`;
    case "chiuse":
      return FILTER_CHIUSE;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (intent !== "assegna") {
    return json({ error: "Intent non valido" }, 400);
  }
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mode = String(formData.get("mode") ?? "one");
  const mediatoreIds = String(formData.get("mediatoreIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const res = await callRiconciliamoApi(request, "/api/riconciliamo/mediazioni/assegna", {
    method: "POST",
    body: JSON.stringify({ ids, mode, mediatoreIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json({ error: (data as { message?: string }).message ?? "Assegnazione fallita" }, res.status);
  }
  return json({ ok: true, ...(data as object) });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const role = getCurrentRole(user);
  const canCreate = role === "admin" || role === "manager";
  const canDelete = role === "admin" || role === "manager";
  const canAssign = canCreate;
  const url = new URL(request.url);

  const tabParam = url.searchParams.get("tab")?.trim() ?? "aperte";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "aperte";
  // Mediatori cannot use da-assegnare
  const effectiveTab: Tab =
    tab === "da-assegnare" && !canAssign ? "aperte" : tab;

  const rgm = url.searchParams.get("rgm")?.trim() ?? "";
  const oggetto = url.searchParams.get("oggetto")?.trim() ?? "";
  const valore = url.searchParams.get("valore")?.trim() ?? "";
  const esito = url.searchParams.get("esito")?.trim() ?? "";
  const data_da = url.searchParams.get("data_da")?.trim() ?? "";
  const data_a = url.searchParams.get("data_a")?.trim() ?? "";
  const data_deposito_da = url.searchParams.get("data_deposito_da")?.trim() ?? "";
  const data_deposito_a = url.searchParams.get("data_deposito_a")?.trim() ?? "";
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
  filterParts.push(tabBaseFilter(effectiveTab));
  if (rgm) filterParts.push(pb.filter("rgm ~ {:rgm}", { rgm }));
  if (oggetto) filterParts.push(pb.filter("oggetto ~ {:oggetto}", { oggetto }));
  if (valore) filterParts.push(pb.filter("valore ~ {:valore}", { valore }));
  if (esito) filterParts.push(`esito_finale = "${esito}"`);
  if (data_deposito_da) filterParts.push(`data_deposito >= "${data_deposito_da}"`);
  if (data_deposito_a) filterParts.push(`data_deposito <= "${data_deposito_a}"`);
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

  const roleScope = role === "mediatore" ? `mediatore = "${user.id}"` : "";
  const countFilter = (tabKey: Tab) => {
    const parts = [tabBaseFilter(tabKey)];
    if (roleScope) parts.unshift(roleScope);
    return parts.join(" && ");
  };
  // Parallel PB calls on one client need unique/null requestKey (SDK auto-cancel).
  const noCancel = { requestKey: null } as const;

  const [
    result,
    modalitaList,
    mediatoriList,
    countDaAssegnare,
    countDaPianificare,
    countDaNotificare,
    countAperte,
  ] = await Promise.all([
    pb.collection("mediazioni_view").getList(page, perPage, {
      sort,
      ...noCancel,
      ...(filter && { filter }),
    }),
    pb
      .collection("modalita_opzioni")
      .getFullList({ filter: "attivo = true", sort: "nome", ...noCancel })
      .catch(() => []),
    canAssign
      ? pb
          .collection("users")
          .getFullList({
            filter: 'ruolo_corrente = "mediatore" || ruoli ?~ "mediatore"',
            fields: "id,name,email,ruolo_corrente,stato",
            sort: "name",
            ...noCancel,
          })
          .catch(() => [])
      : Promise.resolve([]),
    canAssign
      ? pb
          .collection("mediazioni_view")
          .getList(1, 1, { filter: countFilter("da-assegnare"), ...noCancel })
          .then((r) => r.totalItems ?? 0)
          .catch(() => 0)
      : Promise.resolve(0),
    pb
      .collection("mediazioni_view")
      .getList(1, 1, { filter: countFilter("da-pianificare"), ...noCancel })
      .then((r) => r.totalItems ?? 0)
      .catch(() => 0),
    pb
      .collection("mediazioni_view")
      .getList(1, 1, { filter: countFilter("da-notificare"), ...noCancel })
      .then((r) => r.totalItems ?? 0)
      .catch(() => 0),
    pb
      .collection("mediazioni_view")
      .getList(1, 1, { filter: countFilter("aperte"), ...noCancel })
      .then((r) => r.totalItems ?? 0)
      .catch(() => 0),
  ]);

  const mediazioni = result.items.map((m) => ({
    id: String(m.id),
    rgm: String(m.rgm ?? "—"),
    oggetto: String(m.oggetto ?? "—"),
    valore: String(m.valore ?? "—"),
    modalita_mediazione: String(m.modalita_mediazione ?? "—"),
    esito_finale: String(m.esito_finale ?? "—"),
    stato: String((m as { stato?: string }).stato ?? "—"),
    data_deposito: m.data_deposito ? String(m.data_deposito) : null,
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
  const mediatori = (mediatoriList as { id: string; name?: string; email?: string; stato?: string }[])
    .filter((u) => String(u.stato ?? "").toLowerCase() !== "false" && String(u.stato ?? "") !== "inattivo")
    .map((u) => ({ id: u.id, name: u.name || u.email || u.id }));

  return json({
    mediazioni,
    canCreate,
    canDelete,
    canAssign,
    tab: effectiveTab,
    role: role ?? "",
    mediatori,
    tabCounts: {
      "da-assegnare": countDaAssegnare,
      "da-pianificare": countDaPianificare,
      "da-notificare": countDaNotificare,
      aperte: countAperte,
    },
    filters: {
      rgm,
      oggetto,
      valore,
      esito,
      data_deposito_da,
      data_deposito_a,
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

function DeleteButton({ mediazioneId, canDelete, onDelete }: { mediazioneId: string; canDelete: boolean; onDelete: (id: string) => void }) {
  if (!canDelete) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (confirm("Sei sicuro di voler eliminare questa mediazione?")) {
          onDelete(mediazioneId);
        }
      }}
      className="btn btn-ghost btn-sm btn-square min-h-0 h-8 w-8 p-0 text-error hover:bg-error/10"
      aria-label="Elimina mediazione"
      title="Elimina mediazione"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function filtersRecordFromLoader(filters: {
  rgm: string;
  oggetto: string;
  valore: string;
  esito: string;
  data_deposito_da: string;
  data_deposito_a: string;
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
    data_deposito_da: filters.data_deposito_da,
    data_deposito_a: filters.data_deposito_a,
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
  const {
    mediazioni,
    filters,
    sortField,
    order,
    page,
    perPage,
    totalPages,
    totalItems,
    modalitaOptions,
    canDelete,
    canCreate,
    canAssign,
    tab,
    mediatori,
    tabCounts,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const assignFetcher = useFetcher<typeof action>();
  const selectionIdsFetcher = useFetcher<{ ids?: string[]; error?: string }>();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [assignMode, setAssignMode] = useState<"one" | "distribute">("one");
  const [mediatoreOne, setMediatoreOne] = useState("");
  const [mediatoreMulti, setMediatoreMulti] = useState<string[]>([]);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const pendingSelectionKeyRef = useRef<string | null>(null);
  const lastLoadedSelectionKeyRef = useRef<string | null>(null);

  const pageIds = useMemo(() => mediazioni.map((m) => m.id), [mediazioni]);

  // Stable key for current filters (ignore pagination). Reset selection when it changes.
  const selectionFilterKey = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("page");
    next.delete("per_page");
    next.set("tab", "da-assegnare");
    return next.toString();
  }, [searchParams]);

  useEffect(() => {
    setSelectedIds([]);
    setLastClickedIndex(null);
    pendingSelectionKeyRef.current = null;
    lastLoadedSelectionKeyRef.current = null;
  }, [selectionFilterKey]);

  useEffect(() => {
    setLastClickedIndex(null);
  }, [page]);

  useEffect(() => {
    if (!selectionIdsFetcher.data?.ids) return;
    if (pendingSelectionKeyRef.current !== selectionFilterKey) return;
    pendingSelectionKeyRef.current = null;
    lastLoadedSelectionKeyRef.current = selectionFilterKey;
    setSelectedIds(selectionIdsFetcher.data.ids);
  }, [selectionIdsFetcher.data, selectionFilterKey]);

  const allCurrentPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allListSelected = totalItems > 0 && selectedIds.length === totalItems;
  const headerCheckboxChecked = allCurrentPageSelected || allListSelected;
  const isSelectionIdsLoading =
    selectionIdsFetcher.state === "loading" || selectionIdsFetcher.state === "submitting";

  useEffect(() => {
    const checkbox = headerCheckboxRef.current;
    if (!checkbox) return;
    checkbox.indeterminate =
      selectedIds.length > 0 && !allCurrentPageSelected && !allListSelected;
  }, [selectedIds.length, allCurrentPageSelected, allListSelected]);

  const hiddenFields: Record<string, string> = {
    sort: sortField,
    order,
    per_page: String(perPage),
    page: "1",
    tab,
  };

  function handleDelete(id: string) {
    fetcher.submit(
      { _action: "delete_mediazione" },
      { method: "post", action: `/mediazioni/${id}` }
    );
  }

  function tabUrl(nextTab: Tab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    next.set("page", "1");
    return `/mediazioni?${next.toString()}`;
  }

  function handleRowSelect(id: string, index: number, shiftKey: boolean) {
    if (shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds.slice(start, end + 1)])));
    } else {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
      setLastClickedIndex(index);
    }
  }

  /** 1° pagina · 2° lista filtrata · 3° reset */
  function handleCycleSelection() {
    if (allListSelected) {
      setSelectedIds([]);
      setLastClickedIndex(null);
      return;
    }

    if (allCurrentPageSelected) {
      if (
        selectionIdsFetcher.data?.ids &&
        lastLoadedSelectionKeyRef.current === selectionFilterKey &&
        !selectionIdsFetcher.data.error
      ) {
        setSelectedIds(selectionIdsFetcher.data.ids);
        return;
      }
      pendingSelectionKeyRef.current = selectionFilterKey;
      selectionIdsFetcher.load(`/mediazioni/selection-ids?${selectionFilterKey}`);
      return;
    }

    setSelectedIds([...pageIds]);
    setLastClickedIndex(null);
  }

  function submitAssign() {
    if (selectedIds.length === 0) return;
    const mediatoreIds =
      assignMode === "one" ? (mediatoreOne ? [mediatoreOne] : []) : mediatoreMulti;
    if (mediatoreIds.length === 0) return;
    assignFetcher.submit(
      {
        intent: "assegna",
        ids: selectedIds.join(","),
        mode: assignMode,
        mediatoreIds: mediatoreIds.join(","),
      },
      { method: "post" }
    );
    setSelectedIds([]);
    setLastClickedIndex(null);
  }

  const cellTruncate = "align-top";
  const headerBgSolid = "bg-base-200";
  const [expandedNota, setExpandedNota] = useState<Set<string>>(new Set());
  const zebraEven = { backgroundColor: "color-mix(in oklab, var(--color-primary, #3aaeba) 6%, transparent)" };
  const showCheckboxes = canAssign && tab === "da-assegnare";
  const colSpan = showCheckboxes ? 15 : 14;

  const tabItems: { id: Tab; label: string; count?: number; show?: boolean }[] = [
    { id: "da-assegnare", label: "Da assegnare", count: tabCounts["da-assegnare"], show: canAssign },
    { id: "da-pianificare", label: "Da pianificare", count: tabCounts["da-pianificare"], show: true },
    { id: "da-notificare", label: "Da notificare", count: tabCounts["da-notificare"], show: true },
    { id: "aperte", label: "Aperte", count: tabCounts.aperte, show: true },
    { id: "chiuse", label: "Chiuse", show: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-base-content">Mediazioni</h1>
          <p className="text-sm text-base-content/60 mt-0.5">
            Code di lavoro, pratiche aperte e storico chiusure.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => navigate(`/mediazioni?tab=${tab}`)}
            className="btn btn-ghost btn-sm"
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
            className="btn btn-outline btn-sm"
          >
            Esporta
          </button>
          {canCreate && (
            <div className="dropdown dropdown-end">
              <button type="button" tabIndex={0} className="btn btn-ghost btn-sm">
                Azioni
                <ChevronDown className="h-4 w-4 opacity-70" />
              </button>
              <ul
                tabIndex={0}
                className="dropdown-content menu menu-sm z-20 mt-1 w-52 rounded-box border border-base-300 bg-base-100 p-2 shadow"
              >
                <li>
                  <Link to="/mediazioni/import">Importa Excel</Link>
                </li>
                <li>
                  <Link to="/mediazioni/import-zip">Importa zip</Link>
                </li>
                <li>
                  <Link to="/mediazioni/chiudi">Chiudi mediazioni</Link>
                </li>
              </ul>
            </div>
          )}
          {canCreate && (
            <Link to="/mediazioni/new" className="btn btn-primary btn-sm">
              Nuova mediazione
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <nav
          className="flex overflow-x-auto rounded-lg border border-base-300 bg-base-200/50 p-1"
          aria-label="Stato mediazioni"
          role="tablist"
        >
          {tabItems
            .filter((t) => t.show)
            .map((t) => {
              const active = tab === t.id;
              const count = t.count;
              return (
                <Link
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  to={tabUrl(t.id)}
                  className={`btn btn-sm flex-shrink-0 gap-1.5 rounded-md px-3 ${
                    active ? "btn-primary" : "btn-ghost"
                  }`}
                >
                  {t.label}
                  {typeof count === "number" && (
                    <span
                      className={`badge badge-sm tabular-nums ${
                        active
                          ? "badge-primary-content/20 bg-white/20 text-primary-content border-0"
                          : count > 0
                            ? "badge-primary"
                            : "badge-ghost opacity-60"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
        </nav>
        {tab === "da-pianificare" && (
          <Link to="/mediazioni/pianifica" className="btn btn-outline btn-sm btn-primary">
            Pianifica incontri
          </Link>
        )}
      </div>

      {showCheckboxes && (
        <div className="rounded-lg border border-base-300 bg-base-100 p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-base-content">
                {selectedIds.length === 0
                  ? "Nessuna selezione"
                  : `${selectedIds.length} selezionate${
                      allListSelected ? ` / ${totalItems}` : ""
                    }`}
                {isSelectionIdsLoading ? "…" : ""}
              </p>
              <p className="text-xs text-base-content/55 mt-0.5">
                Checkbox testata: pagina → tutti → nessuno
                {selectionIdsFetcher.data?.error
                  ? ` · ${selectionIdsFetcher.data.error}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="join">
                <button
                  type="button"
                  className={`btn btn-sm join-item ${assignMode === "one" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setAssignMode("one")}
                >
                  A uno
                </button>
                <button
                  type="button"
                  className={`btn btn-sm join-item ${assignMode === "distribute" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setAssignMode("distribute")}
                >
                  Distribuisci
                </button>
              </div>
              {assignMode === "one" ? (
                <select
                  className="select select-bordered select-sm min-w-[11rem]"
                  value={mediatoreOne}
                  onChange={(e) => setMediatoreOne(e.target.value)}
                  aria-label="Mediatore"
                >
                  <option value="">Mediatore…</option>
                  {mediatori.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="dropdown dropdown-end">
                  <button type="button" tabIndex={0} className="btn btn-sm btn-outline min-w-[11rem] justify-between">
                    {mediatoreMulti.length === 0
                      ? "Mediatori…"
                      : `${mediatoreMulti.length} mediatori`}
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </button>
                  <ul
                    tabIndex={0}
                    className="dropdown-content menu menu-sm z-20 mt-1 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow max-h-56 overflow-y-auto"
                  >
                    {mediatori.map((m) => {
                      const checked = mediatoreMulti.includes(m.id);
                      return (
                        <li key={m.id}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-xs"
                              checked={checked}
                              onChange={() => {
                                setMediatoreMulti((prev) =>
                                  checked ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                                );
                              }}
                            />
                            <span className="truncate">{m.name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={
                  selectedIds.length === 0 ||
                  assignFetcher.state !== "idle" ||
                  (assignMode === "one" ? !mediatoreOne : mediatoreMulti.length === 0)
                }
                onClick={submitAssign}
              >
                {assignFetcher.state !== "idle" ? "Assegnazione…" : "Assegna"}
              </button>
            </div>
          </div>
          {assignFetcher.data && "ok" in assignFetcher.data && (
            <div className="alert alert-success py-2 text-sm">
              Assegnate {(assignFetcher.data as { assigned?: number }).assigned ?? 0}
            </div>
          )}
          {assignFetcher.data && "error" in assignFetcher.data && (
            <div className="alert alert-error py-2 text-sm">
              {String((assignFetcher.data as { error?: string }).error)}
            </div>
          )}
          {mediatori.length === 0 && (
            <div className="alert alert-warning py-2 text-sm">Nessun utente con ruolo mediatore.</div>
          )}
        </div>
      )}

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
                {showCheckboxes && (
                  <th className={`${filterableTableThClass} w-10`}>
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={headerCheckboxChecked}
                      disabled={isSelectionIdsLoading || pageIds.length === 0}
                      onChange={handleCycleSelection}
                      title="1 click: pagina · 2 click: tutti · 3 click: deseleziona"
                      aria-label="Seleziona pagina, poi tutti, poi deseleziona"
                    />
                  </th>
                )}
                <th className={`${filterableTableThClass} min-w-[90px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="RGM" field="rgm" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterTextInput name="rgm" defaultValue={filters.rgm} placeholder="Cerca RGM" />
                </th>
                <th className={`${filterableTableThClass} min-w-[200px]`}>
                  <div className={filterableTableHeaderLabelClass}>
                    <SortLink label="Data deposito" field="data_deposito" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                  </div>
                  <FilterDateRange nameFrom="data_deposito_da" nameTo="data_deposito_a" valueFrom={filters.data_deposito_da} valueTo={filters.data_deposito_a} />
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
                  <FilterSelect name="esito" defaultValue={filters.esito} options={ESITO_FINALE_FILTER_OPTIONS} emptyLabel="Tutti" />
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
                  <td colSpan={colSpan} className="text-center text-base-content/70 py-12">
                    Nessuna mediazione trovata.
                  </td>
                </tr>
              ) : (
                mediazioni.map((m, idx) => (
                  <tr key={m.id} className="hover" style={idx % 2 === 1 ? zebraEven : undefined}>
                    {showCheckboxes && (
                      <td className="py-2">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={selectedIds.includes(m.id)}
                          onChange={(e) =>
                            handleRowSelect(m.id, idx, e.nativeEvent.shiftKey)
                          }
                          aria-label={`Seleziona ${m.rgm}`}
                        />
                      </td>
                    )}
                    <td className="py-2">
                      <span className="font-medium truncate block max-w-[90px]">{m.rgm}</span>
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {m.data_deposito ? new Date(m.data_deposito).toLocaleDateString("it-IT") : "—"}
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
                        <DeleteButton mediazioneId={m.id} canDelete={canDelete} onDelete={handleDelete} />
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
