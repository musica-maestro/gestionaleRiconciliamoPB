import { Link, useLoaderData, useSearchParams, useNavigate, useFetcher, useActionData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Rubrica" }];
import { requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import {
  FilterableTable,
  FilterTextInput,
  SortLink,
  filterableTableThClass,
  filterableTableHeaderLabelClass,
} from "~/components/data-table";
import { ChevronLeft, ChevronRight, Eye, MoreVertical } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { UnisciRubricaDialog } from "~/components/unisci-rubrica-dialog";
import type { RubricaItem } from "~/components/unisci-rubrica-dialog";

const MAIN_COLOR = "#3aaeba";
const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const tab = tabParam === "giuridiche" || tabParam === "avvocati" ? tabParam : "fisiche";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const comune = url.searchParams.get("comune")?.trim() ?? "";
  const cf = url.searchParams.get("cf")?.trim() ?? "";
  const provincia = url.searchParams.get("provincia")?.trim() ?? "";
  const cap = url.searchParams.get("cap")?.trim() ?? "";
  const email_pec = url.searchParams.get("email_pec")?.trim() ?? "";
  const foro = url.searchParams.get("foro")?.trim() ?? "";
  const pec_avv = url.searchParams.get("pec_avv")?.trim() ?? "";
  const telefono = url.searchParams.get("telefono")?.trim() ?? "";
  const tessera_foro = url.searchParams.get("tessera_foro")?.trim() ?? "";
  const sortF = url.searchParams.get("sort_f") || "display";
  const orderF = url.searchParams.get("order_f") === "asc" ? "asc" : "desc";
  const sortG = url.searchParams.get("sort_g") || "display";
  const orderG = url.searchParams.get("order_g") === "asc" ? "asc" : "desc";
  const sortA = url.searchParams.get("sort_a") || "display";
  const orderA = url.searchParams.get("order_a") === "asc" ? "asc" : "desc";

  const pageF = Math.max(1, parseInt(url.searchParams.get("page_f") ?? "1", 10) || 1);
  const perPageF = PER_PAGE_OPTIONS.includes(Number(url.searchParams.get("per_page_f")) as (typeof PER_PAGE_OPTIONS)[number])
    ? (Number(url.searchParams.get("per_page_f")) as (typeof PER_PAGE_OPTIONS)[number])
    : 10;
  const pageG = Math.max(1, parseInt(url.searchParams.get("page_g") ?? "1", 10) || 1);
  const perPageG = PER_PAGE_OPTIONS.includes(Number(url.searchParams.get("per_page_g")) as (typeof PER_PAGE_OPTIONS)[number])
    ? (Number(url.searchParams.get("per_page_g")) as (typeof PER_PAGE_OPTIONS)[number])
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
  const applySoggettiFilters = (list: Record<string, unknown>[]) => {
    let out = list;
    if (q) {
      out = out.filter((s: Record<string, unknown>) => {
        const nome = String(s.nome ?? "").toLowerCase();
        const cognome = String(s.cognome ?? "").toLowerCase();
        const rs = String(s.ragione_sociale ?? "").toLowerCase();
        const cfS = String(s.codice_fiscale ?? "").toLowerCase();
        const comuneS = String(s.comune ?? "").toLowerCase();
        return [nome, cognome, rs, cfS, comuneS].some((x) => x.includes(filterLower));
      });
    }
    if (comune) {
      const c = comune.toLowerCase();
      out = out.filter((s: Record<string, unknown>) => String(s.comune ?? "").toLowerCase().includes(c));
    }
    if (cf) {
      const c = cf.toLowerCase();
      out = out.filter((s: Record<string, unknown>) => String(s.codice_fiscale ?? "").toLowerCase().includes(c));
    }
    if (provincia) {
      const p = provincia.toLowerCase();
      out = out.filter((s: Record<string, unknown>) => String(s.provincia ?? "").toLowerCase().includes(p));
    }
    if (cap) {
      const c = cap.toLowerCase();
      out = out.filter((s: Record<string, unknown>) => String(s.cap ?? "").toLowerCase().includes(c));
    }
    if (email_pec) {
      const e = email_pec.toLowerCase();
      out = out.filter((s: Record<string, unknown>) => {
        const email = String(s.email ?? "").toLowerCase();
        const pec = String(s.pec ?? "").toLowerCase();
        return email.includes(e) || pec.includes(e);
      });
    }
    return out;
  };

  const soggettiRespList = soggettiResp as Record<string, unknown>[];
  const soggettiFisiciRaw = soggettiRespList.filter((s: Record<string, unknown>) => s.tipo === "Fisica");
  const soggettiGiuridiciRaw = soggettiRespList.filter((s: Record<string, unknown>) => s.tipo === "Giuridica");
  const soggettiFisiciFiltered = applySoggettiFilters(soggettiFisiciRaw);
  const soggettiGiuridiciFiltered = applySoggettiFilters(soggettiGiuridiciRaw);

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

  const toSoggettoRow = (s: Record<string, unknown>) => ({
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
  });

  const fisicheRows = soggettiFisiciFiltered.map((s: Record<string, unknown>) => toSoggettoRow(s));
  const giuridicheRows = soggettiGiuridiciFiltered.map((s: Record<string, unknown>) => toSoggettoRow(s));
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
  const fisicheSorted = sortRows(fisicheRows, sortF, orderF);
  const giuridicheSorted = sortRows(giuridicheRows, sortG, orderG);
  const avvocatiSorted = sortRows(avvocatiRows, sortA, orderA);

  const totalFisiche = fisicheSorted.length;
  const totalPagesF = Math.max(1, Math.ceil(totalFisiche / perPageF));
  const fisiche = fisicheSorted.slice((pageF - 1) * perPageF, pageF * perPageF);

  const totalGiuridiche = giuridicheSorted.length;
  const totalPagesG = Math.max(1, Math.ceil(totalGiuridiche / perPageG));
  const giuridiche = giuridicheSorted.slice((pageG - 1) * perPageG, pageG * perPageG);

  const totalAvvocati = avvocatiSorted.length;
  const totalPagesA = Math.max(1, Math.ceil(totalAvvocati / perPageA));
  const avvocati = avvocatiSorted.slice((pageA - 1) * perPageA, pageA * perPageA);

  const allSoggettiSorted = sortRows(
    soggettiRespList.map((s: Record<string, unknown>) => toSoggettoRow(s)),
    "display",
    "asc"
  );
  const allSoggettiForMerge: RubricaItem[] = allSoggettiSorted.map((s) => ({ id: s.id, display: s.display }));
  const allAvvocatiForMerge: RubricaItem[] = avvocatiSorted.map((a) => ({ id: a.id, display: a.display }));

  return json({
    fisiche,
    giuridiche,
    avvocati,
    allSoggettiForMerge,
    allAvvocatiForMerge,
    q,
    tab,
    filters: { comune, cf, provincia, cap, email_pec, foro, pec_avv, telefono, tessera_foro },
    sortF,
    orderF,
    sortG,
    orderG,
    sortA,
    orderA,
    pageF,
    perPageF,
    totalPagesF,
    totalItemsF: totalFisiche,
    pageG,
    perPageG,
    totalPagesG,
    totalItemsG: totalGiuridiche,
    pageA,
    perPageA,
    totalPagesA,
    totalItemsA: totalAvvocati,
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
    const tab = String(formData.get("tab") ?? "fisiche");
    return redirect(`/rubrica?tab=${tab}`);
  }

  if (intent === "delete_avvocato") {
    const id = String(formData.get("id") ?? "").trim();
    if (!id) return json({ error: "ID mancante" }, { status: 400 });
    const used = await pb.collection("partecipazioni").getFullList({ filter: `avvocati ?= "${id}"`, limit: 1 });
    if (used.length > 0) {
      return json({ error: "Impossibile eliminare: l'avvocato è usato in una o più mediazioni." }, { status: 400 });
    }
    await pb.collection("avvocati").delete(id);
    return redirect("/rubrica?tab=avvocati");
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
    const tabS = String(formData.get("tab") ?? "fisiche");
    return redirect(`/rubrica?tab=${tabS}`);
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
    return redirect("/rubrica?tab=avvocati");
  }

  return json({ error: "Azione non riconosciuta" }, { status: 400 });
}

function buildPageUrlRubrica(basePath: string, searchParams: URLSearchParams, page: number, paramPrefix: "f" | "g" | "a"): string {
  const next = new URLSearchParams(searchParams);
  next.set(`page_${paramPrefix}`, String(page));
  return `${basePath}?${next.toString()}`;
}

function buildPerPageUrlRubrica(basePath: string, searchParams: URLSearchParams, perPage: number, paramPrefix: "f" | "g" | "a"): string {
  const next = new URLSearchParams(searchParams);
  next.set(`per_page_${paramPrefix}`, String(perPage));
  next.set(`page_${paramPrefix}`, "1");
  return `${basePath}?${next.toString()}`;
}

function RowActionsDropdown({
  kind,
  id,
  display,
  onUnisci,
  onDelete,
}: {
  kind: "soggetti" | "avvocati";
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
              const msg = kind === "soggetti"
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

export default function RubricaIndex() {
  const {
    fisiche,
    giuridiche,
    avvocati,
    allSoggettiForMerge,
    allAvvocatiForMerge,
    q,
    tab,
    filters,
    sortF,
    orderF,
    sortG,
    orderG,
    sortA,
    orderA,
    pageF,
    perPageF,
    totalPagesF,
    totalItemsF,
    pageG,
    perPageG,
    totalPagesG,
    totalItemsG,
    pageA,
    perPageA,
    totalPagesA,
    totalItemsA,
  } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();

  const [mergeState, setMergeState] = useState<{
    kind: "soggetti" | "avvocati";
    sourceId: string;
    sourceDisplay: string;
  } | null>(null);

  const isSubmittingMerge = fetcher.state !== "idle";

  const headerBgSolid = "bg-base-200";
  const zebraEven = { backgroundColor: `${MAIN_COLOR}08` };

  const buildPaginationFooter = (
    page: number,
    totalPages: number,
    totalItems: number,
    paramPrefix: "f" | "g" | "a",
    label: string
  ) => (
    <div className={`flex flex-wrap items-center justify-between gap-3 py-4 px-4 border-t border-base-200 ${headerBgSolid}`}>
      <div className="flex items-center gap-4 flex-nowrap">
        <p className="text-sm text-base-content/70">
          Pagina {page} di {totalPages} ({totalItems} {label})
        </p>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap shrink-0">
          <span className="text-base-content/70">Per pagina:</span>
          <select
            value={paramPrefix === "f" ? perPageF : paramPrefix === "g" ? perPageG : perPageA}
            onChange={(e) => navigate(buildPerPageUrlRubrica("/rubrica", searchParams, Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number], paramPrefix))}
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
            to={buildPageUrlRubrica("/rubrica", searchParams, page - 1, paramPrefix)}
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
                if (page <= 3) links.push(2, 3, "ellipsis", totalPages);
                else if (page >= totalPages - 2) links.push("ellipsis", totalPages - 2, totalPages - 1, totalPages);
                else links.push("ellipsis", page - 1, page, page + 1, "ellipsis", totalPages);
              }
              return links.map((item, i) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-${paramPrefix}-${i}`} className="px-1 text-base-content/50">…</span>
                ) : (
                  <Link
                    key={item}
                    to={buildPageUrlRubrica("/rubrica", searchParams, item, paramPrefix)}
                    className={`btn btn-sm min-w-[2rem] ${item === page ? "btn-primary" : "btn-ghost"}`}
                  >
                    {item}
                  </Link>
                )
              );
            })()}
          </div>
          <Link
            to={buildPageUrlRubrica("/rubrica", searchParams, page + 1, paramPrefix)}
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

  const paginationFooterF = buildPaginationFooter(pageF, totalPagesF, totalItemsF, "f", "persone fisiche");
  const paginationFooterG = buildPaginationFooter(pageG, totalPagesG, totalItemsG, "g", "persone giuridiche");

  const paginationFooterA = buildPaginationFooter(pageA, totalPagesA, totalItemsA, "a", "avvocati");

  const tabParams = (t: string) => {
    const p = new URLSearchParams(searchParams);
    p.set("tab", t);
    return p.toString();
  };

  const azzeraUrl = `/rubrica?tab=${tab}`;

  const sortLinkPropsF = {
    basePath: "/rubrica",
    sortParam: "sort_f" as const,
    orderParam: "order_f" as const,
    currentSort: sortF,
    currentOrder: orderF,
    searchParams,
  };
  const sortLinkPropsG = {
    basePath: "/rubrica",
    sortParam: "sort_g" as const,
    orderParam: "order_g" as const,
    currentSort: sortG,
    currentOrder: orderG,
    searchParams,
  };
  const sortLinkPropsA = {
    basePath: "/rubrica",
    sortParam: "sort_a" as const,
    orderParam: "order_a" as const,
    currentSort: sortA,
    currentOrder: orderA,
    searchParams,
  };

  const handleMergeConfirm = (targetId: string) => {
    if (!mergeState) return;
    const intent = mergeState.kind === "soggetti" ? "merge_soggetto" : "merge_avvocato";
    const payload: Record<string, string> = { intent, source_id: mergeState.sourceId, target_id: targetId };
    if (mergeState.kind === "soggetti") payload.tab = tab;
    fetcher.submit(payload, { method: "post" });
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
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-base-200/60 border border-base-300 w-fit">
          <Link
            to={`?${tabParams("fisiche")}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "fisiche" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/80 hover:text-base-content hover:bg-base-300/50"}`}
          >
            Persone fisiche
          </Link>
          <Link
            to={`?${tabParams("giuridiche")}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "giuridiche" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/80 hover:text-base-content hover:bg-base-300/50"}`}
          >
            Persone giuridiche
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

      {tab === "fisiche" && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8">
          <FilterableTable
            id="rubrica-fisiche-filters-form"
            method="get"
            hiddenFields={{
              tab: "fisiche",
              sort_f: sortF,
              order_f: orderF,
              page_f: "1",
              per_page_f: String(perPageF),
            }}
            className="overflow-visible"
            footer={paginationFooterF}
          >
            <div>
              <table className="table table-sm w-full min-w-[800px]">
                <thead className={`sticky top-0 z-10 shadow-sm ${headerBgSolid}`}>
                <tr>
                  <th className={`${filterableTableThClass} min-w-[100px]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Nome" field="display" {...sortLinkPropsF} />
                    </div>
                    <FilterTextInput name="q" type="search" defaultValue={q} placeholder="Cerca…" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="CF" field="codice_fiscale" {...sortLinkPropsF} />
                    </div>
                    <FilterTextInput name="cf" defaultValue={filters.cf} placeholder="CF" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Comune" field="comune" {...sortLinkPropsF} />
                    </div>
                    <FilterTextInput name="comune" defaultValue={filters.comune} placeholder="Comune" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Provincia" field="provincia" {...sortLinkPropsF} />
                    </div>
                    <FilterTextInput name="provincia" defaultValue={filters.provincia} placeholder="Provincia" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="CAP" field="cap" {...sortLinkPropsF} />
                    </div>
                    <FilterTextInput name="cap" defaultValue={filters.cap} placeholder="CAP" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>Email / PEC</div>
                    <FilterTextInput name="email_pec" defaultValue={filters.email_pec} placeholder="Email o PEC" />
                  </th>
                  <th className={`${filterableTableThClass} w-0`}>
                    <div className={filterableTableHeaderLabelClass}>Azioni</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fisiche.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-base-content/70 py-12">
                      Nessuna persona fisica trovata.
                    </td>
                  </tr>
                ) : (
                  fisiche.map((s, idx) => (
                    <tr key={String(s.id)} className="hover" style={idx % 2 === 1 ? zebraEven : undefined}>
                      <td className="py-2"><Link to={`/rubrica/soggetti/${s.id}`} className="link link-hover font-medium">{s.display}</Link></td>
                      <td className="py-2">{s.codice_fiscale || "—"}</td>
                      <td className="py-2">{s.comune || "—"}</td>
                      <td className="py-2">{s.provincia || "—"}</td>
                      <td className="py-2">{s.cap || "—"}</td>
                      <td className="py-2 max-w-[200px] truncate" title={s.email || s.pec || ""}>{s.email || s.pec || "—"}</td>
                      <td className="py-2">
                        <RowActionsDropdown
                          kind="soggetti"
                          id={s.id}
                          display={s.display}
                          onUnisci={() => setMergeState({ kind: "soggetti", sourceId: s.id, sourceDisplay: s.display })}
                          onDelete={() => fetcher.submit({ intent: "delete_soggetto", id: s.id, tab: "fisiche" }, { method: "post" })}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </FilterableTable>
        </div>
      )}

      {tab === "giuridiche" && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8">
          <FilterableTable
            id="rubrica-giuridiche-filters-form"
            method="get"
            hiddenFields={{
              tab: "giuridiche",
              sort_g: sortG,
              order_g: orderG,
              page_g: "1",
              per_page_g: String(perPageG),
            }}
            className="overflow-visible"
            footer={paginationFooterG}
          >
            <div>
              <table className="table table-sm w-full min-w-[800px]">
                <thead className={`sticky top-0 z-10 shadow-sm ${headerBgSolid}`}>
                <tr>
                  <th className={`${filterableTableThClass} min-w-[100px]`}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Ragione sociale" field="display" {...sortLinkPropsG} />
                    </div>
                    <FilterTextInput name="q" type="search" defaultValue={q} placeholder="Cerca…" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="CF" field="codice_fiscale" {...sortLinkPropsG} />
                    </div>
                    <FilterTextInput name="cf" defaultValue={filters.cf} placeholder="CF" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Comune" field="comune" {...sortLinkPropsG} />
                    </div>
                    <FilterTextInput name="comune" defaultValue={filters.comune} placeholder="Comune" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="Provincia" field="provincia" {...sortLinkPropsG} />
                    </div>
                    <FilterTextInput name="provincia" defaultValue={filters.provincia} placeholder="Provincia" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>
                      <SortLink label="CAP" field="cap" {...sortLinkPropsG} />
                    </div>
                    <FilterTextInput name="cap" defaultValue={filters.cap} placeholder="CAP" />
                  </th>
                  <th className={filterableTableThClass}>
                    <div className={filterableTableHeaderLabelClass}>Email / PEC</div>
                    <FilterTextInput name="email_pec" defaultValue={filters.email_pec} placeholder="Email o PEC" />
                  </th>
                  <th className={`${filterableTableThClass} w-0`}>
                    <div className={filterableTableHeaderLabelClass}>Azioni</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {giuridiche.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-base-content/70 py-12">
                      Nessuna persona giuridica trovata.
                    </td>
                  </tr>
                ) : (
                  giuridiche.map((s, idx) => (
                    <tr key={String(s.id)} className="hover" style={idx % 2 === 1 ? zebraEven : undefined}>
                      <td className="py-2"><Link to={`/rubrica/soggetti/${s.id}`} className="link link-hover font-medium">{s.display}</Link></td>
                      <td className="py-2">{s.codice_fiscale || "—"}</td>
                      <td className="py-2">{s.comune || "—"}</td>
                      <td className="py-2">{s.provincia || "—"}</td>
                      <td className="py-2">{s.cap || "—"}</td>
                      <td className="py-2 max-w-[200px] truncate" title={s.email || s.pec || ""}>{s.email || s.pec || "—"}</td>
                      <td className="py-2">
                        <RowActionsDropdown
                          kind="soggetti"
                          id={s.id}
                          display={s.display}
                          onUnisci={() => setMergeState({ kind: "soggetti", sourceId: s.id, sourceDisplay: s.display })}
                          onDelete={() => fetcher.submit({ intent: "delete_soggetto", id: s.id, tab: "giuridiche" }, { method: "post" })}
                        />
                      </td>
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
              sort_a: sortA,
              order_a: orderA,
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
                  <th className={`${filterableTableThClass} w-0`}>
                    <div className={filterableTableHeaderLabelClass}>Azioni</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {avvocati.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-base-content/70 py-12">
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
                      <td className="py-2">
                        <RowActionsDropdown
                          kind="avvocati"
                          id={a.id}
                          display={a.display}
                          onUnisci={() => setMergeState({ kind: "avvocati", sourceId: a.id, sourceDisplay: a.display })}
                          onDelete={() => fetcher.submit({ intent: "delete_avvocato", id: a.id }, { method: "post" })}
                        />
                      </td>
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
