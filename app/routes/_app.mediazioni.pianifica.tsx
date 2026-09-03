import { useMemo, useRef, useState, useEffect } from "react";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Search } from "lucide-react";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { callRiconciliamoApi } from "~/lib/riconciliamo-api.server";
import { MultiDateCalendarPicker } from "~/components/multi-date-calendar-picker";
import { TimeRangeBar, type TimeRange } from "~/components/time-range-bar";

export const meta = () => [{ title: "Pianifica incontri" }];

function isValidWindow(w: { from: string; to: string }) {
  const [fh, fm] = w.from.split(":").map(Number);
  const [th, tm] = w.to.split(":").map(Number);
  if ([fh, fm, th, tm].some((x) => Number.isNaN(x))) return false;
  return fh * 60 + fm < th * 60 + tm;
}

const PER_PAGE = 10;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  const { pb } = await createPB(request);

  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const filterParts: string[] = [`stato = "assegnata"`];
  if (role === "mediatore") filterParts.push(`mediatore = "${user.id}"`);
  if (searchTerm) {
    filterParts.push(
      pb.filter(
        "(rgm ~ {:q} || oggetto ~ {:q} || istanti_testo ~ {:q} || chiamati_testo ~ {:q} || mediatore_name ~ {:q})",
        { q: searchTerm },
      ),
    );
  }
  const filter = filterParts.join(" && ");

  const [result, countResult] = await Promise.all([
    pb.collection("mediazioni_view").getList(page, PER_PAGE, {
      filter,
      sort: "-data_assegnazione,rgm",
      requestKey: null,
    }),
    pb.collection("mediazioni_view").getList(1, 1, {
      filter: filterParts.filter((_, i) => i < (role === "mediatore" ? 2 : 1)).join(" && "),
      fields: "id",
      requestKey: null,
    }),
  ]);

  return json({
    items: result.items.map((m) => ({
      id: String(m.id),
      rgm: String(m.rgm ?? "—"),
      oggetto: String(m.oggetto ?? "—"),
      mediatore_name: String(m.mediatore_name ?? "—"),
      istanti: m.istanti_testo ? String(m.istanti_testo) : "—",
      chiamati: m.chiamati_testo ? String(m.chiamati_testo) : "—",
    })),
    page,
    totalItems: result.totalItems,
    totalPages: Math.max(1, Math.ceil(result.totalItems / PER_PAGE)),
    totalAll: countResult.totalItems,
    role: role ?? "",
    q: searchTerm,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ error: "JSON non valido" }, 400);
  }
  const res = await callRiconciliamoApi(request, "/api/riconciliamo/mediazioni/pianifica", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json({ error: (data as { message?: string }).message ?? "Pianificazione fallita" }, res.status);
  }
  return json({ ok: true, ...(data as object) });
}

function countSlots(
  dates: string[],
  windows: { from: string; to: string }[],
  durationMin: number,
  parallel: number,
): number {
  let n = 0;
  for (const _d of dates) {
    for (const w of windows) {
      const [fh, fm] = w.from.split(":").map(Number);
      const [th, tm] = w.to.split(":").map(Number);
      if ([fh, fm, th, tm].some((x) => Number.isNaN(x))) continue;
      const from = fh * 60 + fm;
      const to = th * 60 + tm;
      for (let t = from; t + durationMin <= to; t += durationMin) {
        n += Math.max(1, parallel);
      }
    }
  }
  return n;
}

function SectionCard({
  title,
  description,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border-2 border-base-200 bg-base-100 shadow-sm overflow-hidden flex flex-col ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-base-200 bg-base-200/40 shrink-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 shrink-0 text-primary">{icon}</div>
          <div className="min-w-0">
            <h2 className="font-semibold text-base-content">{title}</h2>
            {description && <p className="text-xs text-base-content/60 mt-0.5">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-4 flex-1">{children}</div>
    </section>
  );
}

export default function PianificaMediazioni() {
  const { items, page, totalPages, totalItems, q } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const selectionIdsFetcher = useFetcher<{ ids?: string[]; error?: string }>();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [windows, setWindows] = useState<TimeRange[]>(() => [
    { id: "init", from: "09:00", to: "13:00" },
  ]);
  const [durationMin, setDurationMin] = useState(30);
  const [parallel, setParallel] = useState(1);
  const [searchInput, setSearchInput] = useState(q);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const pendingSelectionKeyRef = useRef<string | null>(null);
  const lastLoadedSelectionKeyRef = useRef<string | null>(null);

  const pageIds = useMemo(() => items.map((m) => m.id), [items]);

  const selectionFilterKey = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("page");
    return next.toString();
  }, [searchParams]);

  useEffect(() => {
    setSelectedIds([]);
    pendingSelectionKeyRef.current = null;
    lastLoadedSelectionKeyRef.current = null;
  }, [selectionFilterKey]);

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

  function handleCycleSelection() {
    if (allListSelected) {
      setSelectedIds([]);
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
      selectionIdsFetcher.load(`/mediazioni/pianifica/selection-ids?${selectionFilterKey}`);
      return;
    }
    setSelectedIds([...pageIds]);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const validWindows = windows.filter(isValidWindow);
  const slots = countSlots(
    dates,
    validWindows.map(({ from, to }) => ({ from, to })),
    durationMin,
    parallel,
  );
  const needed = selectedIds.length;
  const slotsOk = needed === 0 || (slots >= needed && slots > 0);
  const canSubmit =
    needed > 0 && slots >= needed && dates.length > 0 && validWindows.length > 0 && fetcher.state === "idle";

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(p));
    setSearchParams(next);
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set("q", value);
      else next.delete("q");
      next.set("page", "1");
      setSearchParams(next);
    }, 350);
  }

  function submit() {
    fetcher.submit(
      {
        ids: selectedIds,
        dates,
        windows: validWindows.map(({ from, to }) => ({ from, to })),
        durationMin,
        parallel,
      },
      { method: "post", encType: "application/json" },
    );
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header compatto */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-base-content">Pianifica incontri</h1>
          <p className="text-sm text-base-content/60 mt-0.5">
            Scegli le pratiche, i giorni e le fasce orarie. Gli slot si assegnano in ordine; le pratiche passano poi in <strong>Da notificare</strong>.
          </p>
        </div>
        {/* Riepilogo inline */}
        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span><strong>{needed}</strong> selezionate</span>
          <span className="text-base-content/30">·</span>
          <span><strong>{dates.length}</strong> giorni</span>
          <span className="text-base-content/30">·</span>
          <span><strong>{validWindows.length}</strong> {validWindows.length === 1 ? "fascia" : "fasce"}</span>
          <span className="text-base-content/30">·</span>
          <span className={!slotsOk && needed > 0 ? "text-warning font-medium" : ""}>
            <strong>{slots}</strong> slot
          </span>
        </div>
      </div>

      {/* Griglia principale 2×2 */}
      <div className="grid xl:grid-cols-12 xl:grid-rows-[1fr_auto] gap-3 items-stretch">
        {/* Riga 1 sinistra: ricerca + tabella */}
        <div className="xl:col-span-7 xl:row-span-1 flex flex-col gap-3">
          {/* Ricerca */}
          <label className="input input-bordered input-sm flex items-center gap-2 w-full">
            <Search className="h-4 w-4 text-base-content/40" />
            <input
              type="text"
              className="grow bg-transparent outline-none"
              placeholder="Cerca RGM, oggetto, istante, chiamato, mediatore…"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </label>

          {/* Tabella */}
          <div className="rounded-xl border-2 border-base-200 bg-base-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table table-xs w-full">
                <thead>
                  <tr className="text-base-content/70">
                    <th className="w-8">
                      <input
                        ref={headerCheckboxRef}
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={headerCheckboxChecked}
                        disabled={isSelectionIdsLoading || pageIds.length === 0}
                        onChange={handleCycleSelection}
                        title="1 click: pagina · 2: tutte · 3: nessuna"
                        aria-label="Seleziona pagina, poi tutte, poi nessuna"
                      />
                    </th>
                    <th>RGM</th>
                    <th>Oggetto</th>
                    <th>Istanti</th>
                    <th>Chiamati</th>
                    <th className="hidden sm:table-cell">Mediatore</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-base-content/55">
                        Nessuna mediazione trovata.
                      </td>
                    </tr>
                  ) : (
                    items.map((m) => (
                      <tr key={m.id} className="hover">
                        <td>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={selectedIds.includes(m.id)}
                            onChange={() => toggleSelect(m.id)}
                            aria-label={`Seleziona ${m.rgm}`}
                          />
                        </td>
                        <td className="font-medium whitespace-nowrap">{m.rgm}</td>
                        <td className="max-w-[10rem] truncate" title={m.oggetto}>{m.oggetto}</td>
                        <td className="max-w-[8rem] truncate" title={m.istanti}>{m.istanti}</td>
                        <td className="max-w-[8rem] truncate" title={m.chiamati}>{m.chiamati}</td>
                        <td className="hidden sm:table-cell max-w-[7rem] truncate" title={m.mediatore_name}>
                          {m.mediatore_name}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginazione + selezione */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-base-200 text-xs text-base-content/60">
              <span>
                Pag. {page}/{totalPages} ({totalItems})
                {needed > 0 && (
                  <> · {needed} selezionat{needed === 1 ? "a" : "e"}{allListSelected ? " (tutte)" : ""}{isSelectionIdsLoading ? " …" : ""}</>
                )}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost btn-square"
                    disabled={page <= 1}
                    onClick={() => goToPage(page - 1)}
                    aria-label="Precedente"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  {(() => {
                    const maxButtons = 7;
                    let start = Math.max(1, page - Math.floor(maxButtons / 2));
                    const end = Math.min(totalPages, start + maxButtons - 1);
                    start = Math.max(1, end - maxButtons + 1);
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`btn btn-xs min-w-[1.5rem] ${p === page ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => goToPage(p)}
                      >
                        {p}
                      </button>
                    ));
                  })()}
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost btn-square"
                    disabled={page >= totalPages}
                    onClick={() => goToPage(page + 1)}
                    aria-label="Successiva"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Riga 1 destra: calendario */}
        <div className="xl:col-span-5 xl:row-span-1">
          <SectionCard
            title="Date disponibili"
            description="Clicca o trascina per selezionare i giorni."
            icon={<CalendarDays className="h-5 w-5" />}
            className="h-full"
          >
            <MultiDateCalendarPicker value={dates} onChange={setDates} className="text-sm" />
          </SectionCard>
        </div>

        {/* Riga 2 sinistra: fasce orarie */}
        <div className="xl:col-span-7 xl:row-span-1">
          <SectionCard
            title="Fasce orarie"
            description="Trascina sulla barra per selezionare le fasce."
            icon={<Clock className="h-5 w-5" />}
            className="h-full"
          >
            <TimeRangeBar ranges={windows} onChange={setWindows} />
          </SectionCard>
        </div>

        {/* Riga 2 destra: impostazioni slot */}
        <div className="xl:col-span-5 xl:row-span-1">
          <SectionCard
            title="Impostazioni slot"
            description="Configura durata e parallelismo degli incontri."
            icon={<Clock className="h-5 w-5" />}
            className="h-full"
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-base-content/70">Durata slot</span>
                <span className="text-[11px] text-base-content/50">Minuti per incontro</span>
                <input
                  type="number"
                  min={5}
                  className="input input-bordered input-sm w-full mt-1"
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value) || 30)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-base-content/70">Parallele</span>
                <span className="text-[11px] text-base-content/50">Incontri contemporanei</span>
                <input
                  type="number"
                  min={1}
                  className="input input-bordered input-sm w-full mt-1"
                  value={parallel}
                  onChange={(e) => setParallel(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Feedback */}
      {fetcher.data && "ok" in fetcher.data && (
        <div className="alert alert-success shadow-sm">
          <span>
            Creati {(fetcher.data as { created?: number }).created ?? 0} incontri.{" "}
            <Link to="/mediazioni?tab=da-notificare" className="link font-medium">
              Vai a Da notificare
            </Link>
          </span>
        </div>
      )}
      {fetcher.data && "error" in fetcher.data && (
        <div className="alert alert-error shadow-sm">
          {String((fetcher.data as { error?: string }).error)}
        </div>
      )}

      {/* Barra azioni fissa */}
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-base-300 bg-base-100/95 backdrop-blur supports-[backdrop-filter]:bg-base-100/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className={`text-sm ${slotsOk ? "text-base-content/70" : "text-warning font-medium"}`}>
            {needed === 0
              ? "Seleziona almeno una mediazione"
              : dates.length === 0
                ? "Seleziona almeno un giorno"
                : validWindows.length === 0
                  ? "Imposta almeno una fascia oraria valida"
                  : !slotsOk
                    ? `Slot insufficienti: ${slots} disponibili, ${needed} richiesti`
                    : `Pronto: ${needed} incontri su ${slots} slot`}
          </p>
          <div className="flex items-center gap-2">
            <Link to="/mediazioni?tab=da-pianificare" className="btn btn-ghost btn-sm">
              Annulla
            </Link>
            <button
              type="button"
              className="btn btn-primary btn-sm min-w-[9rem]"
              disabled={!canSubmit}
              onClick={submit}
            >
              {fetcher.state !== "idle" ? "Pianificazione…" : "Crea incontri"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
