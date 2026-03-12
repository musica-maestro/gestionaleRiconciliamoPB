import { Link, useLoaderData, useSearchParams, useNavigation } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";

export const meta: MetaFunction = () => [{ title: "Dashboard" }];
import { requireUser, canSeeFatture } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import {
  formatMonth,
  formatEuro,
  CHART_COLORS,
  PIE_COLORS,
  type DashboardView,
} from "~/lib/dashboard-utils";
import {
  DashboardStatsCard,
  DashboardTabNav,
  TassiChart,
} from "~/components/dashboard";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = user.ruolo_corrente ?? user.ruoli?.[0];
  const showFatture = canSeeFatture(role);
  const url = new URL(request.url);
  const monthFilter = url.searchParams.get("month") || "";

  let totaleMediazioni = 0;
  let totaleFatture = 0;
  let prossimoIncontro: { id: string; data_inizio: string; mediazione_id: string; rgm: string } | null = null;
  let mediazioniByMediatore: { name: string; value: number }[] = [];
  let mediazioniByMonth: { name: string; value: number }[] = [];
  let fattureByMediatore: { name: string; value: number }[] = [];
  let incassiByMonth: { name: string; value: number }[] = [];
  let openByMediatore: { name: string; value: number }[] = [];
  let closedByEsito: { name: string; value: number }[] = [];
  let monthlyRates: { month: string; totale: number; conIncontro: number; tassoAdesione: number; accordo: number; tassoEsitoPositivo: number }[] = [];
  let monthlyRatesByMediatore: { mediatore_name: string; mediatore_id: string; data: typeof monthlyRates }[] = [];
  let availableMonths: string[] = [];
  let mediatoreStats: {
    mediatore_name: string;
    aperte: number;
    in_corso: number;
    chiuse: number;
    accordo: number;
    mancato_accordo: number;
    improcedibile: number;
    chiusa_ufficio: number;
  }[] = [];
  let loaderError: string | null = null;
  let mediazioniTrend: { delta: number; label: string } | null = null;
  let incassiTrend: { delta: number; label: string } | null = null;
  const isMediatore = role === "mediatore";

  try {
    const { pb } = await createPB(request);
    const medFilter = isMediatore ? `mediatore = "${user.id}"` : undefined;

    const filterAperte = medFilter;
    const filterMese = medFilter;
    const filterChiuseParts = [medFilter, monthFilter ? `mese_chiusura = "${monthFilter}"` : null].filter(
      (x): x is string => Boolean(x)
    );
    const filterChiuse = filterChiuseParts.length > 0 ? filterChiuseParts.join(" && ") : undefined;
    const filterTassi = medFilter;

    const noCancel = { requestKey: null };
    const opts = (f: string | undefined) => ({ ...(f && { filter: f }), ...noCancel });
    const [
      mediazioniList,
      incontriList,
      fattureCount,
      aperteList,
      meseList,
      chiuseList,
      tassiList,
      mediatoreStatsList,
      fattureAll,
      usersList,
    ] = await Promise.all([
      pb.collection("mediazioni_view").getList(1, 1, opts(medFilter)),
      pb.collection("incontri").getList(1, 5, {
        sort: "data_programmazione",
        expand: "mediazione",
        filter: isMediatore
          ? `data_programmazione >= "${new Date().toISOString().slice(0, 19)}" && mediazione.mediatore = "${user.id}"`
          : `data_programmazione >= "${new Date().toISOString().slice(0, 19)}"`,
        ...noCancel,
      }),
      showFatture ? pb.collection("fatture").getList(1, 1, noCancel) : Promise.resolve({ totalItems: 0 }),
      pb.collection("dashboard_aperte_per_mediatore").getFullList(opts(filterAperte)),
      pb.collection("dashboard_mediazioni_per_mese").getFullList(opts(filterMese)),
      pb.collection("dashboard_chiuse_per_esito_mese").getFullList(opts(filterChiuse)),
      pb.collection("dashboard_tassi_mensili").getFullList(opts(filterTassi)),
      pb.collection("dashboard_mediatore_stats").getFullList(opts(filterAperte)),
      showFatture
        ? pb.collection("fatture").getFullList({ expand: "mediazione", ...noCancel })
        : Promise.resolve([]),
      pb.collection("users").getFullList({ fields: "id,name", ...noCancel }),
    ]);

    totaleMediazioni = mediazioniList.totalItems;
    totaleFatture = (fattureCount as { totalItems: number }).totalItems ?? 0;
    const first = incontriList.items[0] as Record<string, string> | undefined;
    const expand = first?.expand as Record<string, { rgm?: string }> | undefined;
    if (first) {
      prossimoIncontro = {
        id: first.id,
        data_inizio: (first.data_programmazione ?? first.data_inizio ?? "") as string,
        mediazione_id: (first.mediazione ?? "") as string,
        rgm: expand?.mediazione?.rgm ?? "—",
      };
    }

    const usersById: Record<string, string> = {};
    for (const u of usersList as { id: string; name?: string }[]) {
      usersById[u.id] = u.name ?? u.id;
    }

    // dashboard_aperte_per_mediatore -> mediazioniByMediatore + openByMediatore
    const aperteRows = aperteList as { mediatore_name?: string; cnt?: number }[];
    mediazioniByMediatore = aperteRows
      .map((r) => ({ name: String(r.mediatore_name ?? "—"), value: Number(r.cnt ?? 0) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    openByMediatore = aperteRows
      .map((r) => ({ name: String(r.mediatore_name ?? "—"), value: Number(r.cnt ?? 0) }))
      .sort((a, b) => b.value - a.value);

    // dashboard_mediazioni_per_mese: aggregate by mese (admin ha più righe per mediatore)
    const meseRows = meseList as { mese?: string; cnt?: number }[];
    const monthCount: Record<string, number> = {};
    for (const r of meseRows) {
      const m = String(r.mese ?? "");
      if (m) monthCount[m] = (monthCount[m] ?? 0) + Number(r.cnt ?? 0);
    }
    mediazioniByMonth = Object.entries(monthCount)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([name, value]) => ({ name, value }));

    // Trend: ultimi 2 mesi mediazioni
    if (mediazioniByMonth.length >= 2) {
      const [prev, curr] = mediazioniByMonth.slice(-2);
      const prevVal = prev.value;
      const currVal = curr.value;
      mediazioniTrend = {
        delta: currVal - prevVal,
        label: `rispetto a ${formatMonth(prev.name)}`,
      };
    }

    // dashboard_chiuse_per_esito_mese: aggregate by esito, availableMonths from full list
    const chiuseRows = chiuseList as { esito_finale?: string; mese_chiusura?: string; cnt?: number }[];
    const closedByEsitoMap: Record<string, number> = {};
    const monthsSet = new Set<string>();
    for (const r of chiuseRows) {
      const esito = String(r.esito_finale ?? "");
      closedByEsitoMap[esito] = (closedByEsitoMap[esito] ?? 0) + Number(r.cnt ?? 0);
      const m = String(r.mese_chiusura ?? "");
      if (m) monthsSet.add(m);
    }
    closedByEsito = Object.entries(closedByEsitoMap)
      .map(([n, v]) => ({ name: n, value: v }))
      .sort((a, b) => b.value - a.value);

    // availableMonths: fetch distinct from chiuse (need unfiltered list for dropdown)
    const chiuseAll = await pb
      .collection("dashboard_chiuse_per_esito_mese")
      .getFullList(opts(filterMese));
    for (const r of chiuseAll as { mese_chiusura?: string }[]) {
      const m = String(r.mese_chiusura ?? "");
      if (m) monthsSet.add(m);
    }
    availableMonths = [...monthsSet].sort();

    // dashboard_tassi_mensili: aggregate by mese (admin ha più righe per mediatore)
    const tassiRows = tassiList as {
      mediatore?: string;
      mese?: string;
      totale?: number;
      con_incontro?: number;
      accordo?: number;
    }[];
    const byMonth: Record<string, { totale: number; conIncontro: number; accordo: number }> = {};
    const byMediatoreMonth: Record<string, Record<string, { totale: number; conIncontro: number; accordo: number }>> = {};
    for (const r of tassiRows) {
      const m = String(r.mese ?? "");
      if (!m) continue;
      const medId = String(r.mediatore ?? "");
      const medName = medId ? (usersById[medId] ?? medId) : "—";

      if (!byMonth[m]) byMonth[m] = { totale: 0, conIncontro: 0, accordo: 0 };
      byMonth[m].totale += Number(r.totale ?? 0);
      byMonth[m].conIncontro += Number(r.con_incontro ?? 0);
      byMonth[m].accordo += Number(r.accordo ?? 0);

      if (medId && !isMediatore) {
        if (!byMediatoreMonth[medId]) byMediatoreMonth[medId] = {};
        if (!byMediatoreMonth[medId][m]) byMediatoreMonth[medId][m] = { totale: 0, conIncontro: 0, accordo: 0 };
        byMediatoreMonth[medId][m].totale += Number(r.totale ?? 0);
        byMediatoreMonth[medId][m].conIncontro += Number(r.con_incontro ?? 0);
        byMediatoreMonth[medId][m].accordo += Number(r.accordo ?? 0);
      }
    }
    monthlyRates = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, data]) => ({
        month,
        totale: data.totale,
        conIncontro: data.conIncontro,
        accordo: data.accordo,
        tassoAdesione: data.totale > 0 ? Math.round((data.conIncontro / data.totale) * 100) : 0,
        tassoEsitoPositivo: data.conIncontro > 0 ? Math.round((data.accordo / data.conIncontro) * 100) : 0,
      }));

    for (const [medId, months] of Object.entries(byMediatoreMonth)) {
      const medName = usersById[medId] ?? medId;
      const rates = Object.entries(months)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([month, data]) => ({
          month,
          totale: data.totale,
          conIncontro: data.conIncontro,
          accordo: data.accordo,
          tassoAdesione: data.totale > 0 ? Math.round((data.conIncontro / data.totale) * 100) : 0,
          tassoEsitoPositivo: data.conIncontro > 0 ? Math.round((data.accordo / data.conIncontro) * 100) : 0,
        }));
      monthlyRatesByMediatore.push({ mediatore_id: medId, mediatore_name: medName, data: rates });
    }
    monthlyRatesByMediatore.sort((a, b) => a.mediatore_name.localeCompare(b.mediatore_name));

    mediatoreStats = (mediatoreStatsList as Record<string, unknown>[])
      .filter((r) => r.mediatore && r.mediatore_name)
      .map((r) => ({
        mediatore_name: String(r.mediatore_name ?? "—"),
        aperte: Number(r.aperte ?? 0),
        in_corso: Number(r.in_corso ?? 0),
        chiuse: Number(r.chiuse ?? 0),
        accordo: Number(r.accordo ?? 0),
        mancato_accordo: Number(r.mancato_accordo ?? 0),
        improcedibile: Number(r.improcedibile ?? 0),
        chiusa_ufficio: Number(r.chiusa_ufficio ?? 0),
      }))
      .sort((a, b) => {
        const totA = a.aperte + a.chiuse;
        const totB = b.aperte + b.chiuse;
        return totB - totA;
      });

    if (showFatture && Array.isArray(fattureAll)) {
      const mediatoreSum: Record<string, number> = {};
      const incassiByMonthMap: Record<string, number> = {};
      for (const f of fattureAll as Record<string, unknown>[]) {
        const expandF = f.expand as Record<string, { mediatore?: string }> | undefined;
        const mediazione = expandF?.mediazione as Record<string, string> | undefined;
        const medId = mediazione?.mediatore ?? "";
        const name = usersById[medId] ?? (medId || "—");
        const imp = Number(f.imponibile) || 0;
        if (!mediatoreSum[name]) mediatoreSum[name] = 0;
        mediatoreSum[name] += imp;

        if (f.data_incasso) {
          const month = String(f.data_incasso).slice(0, 7);
          incassiByMonthMap[month] = (incassiByMonthMap[month] ?? 0) + imp;
        }
      }
      fattureByMediatore = Object.entries(mediatoreSum)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
      incassiByMonth = Object.entries(incassiByMonthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([name, value]) => ({ name, value }));

      if (incassiByMonth.length >= 2) {
        const [prev, curr] = incassiByMonth.slice(-2);
        const prevVal = prev.value;
        const currVal = curr.value;
        incassiTrend = {
          delta: Math.round(currVal - prevVal),
          label: `rispetto a ${formatMonth(prev.name)}`,
        };
      }
    }
  } catch (e: unknown) {
    if ((e as { isAbort?: boolean })?.isAbort === true) {
      throw e;
    }
    loaderError = "Impossibile caricare i dati della dashboard. Riprova più tardi.";
    if (process.env.NODE_ENV === "development") {
      console.error("[Dashboard loader]", e);
    }
  }

  return json({
    totaleMediazioni,
    showFatture,
    totaleFatture,
    prossimoIncontro,
    mediazioniByMediatore,
    mediazioniByMonth,
    fattureByMediatore,
    incassiByMonth,
    openByMediatore,
    closedByEsito,
    monthlyRates,
    availableMonths,
    monthFilter,
    mediatoreStats,
    loaderError,
    mediazioniTrend,
    incassiTrend,
    monthlyRatesByMediatore,
    isMediatore,
  });
}

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const rawView = searchParams.get("view") || "overview";
  const view: DashboardView =
    ["overview", "mediazioni", "fatture", "mediatori", "tassi"].includes(rawView)
      ? (rawView as DashboardView)
      : "overview";

  const {
    totaleMediazioni,
    showFatture,
    totaleFatture,
    prossimoIncontro,
    mediazioniByMediatore,
    mediazioniByMonth,
    fattureByMediatore,
    incassiByMonth,
    openByMediatore,
    closedByEsito,
    monthlyRates,
    availableMonths,
    monthFilter,
    mediatoreStats,
    loaderError,
    mediazioniTrend,
    incassiTrend,
    monthlyRatesByMediatore,
    isMediatore,
  } = useLoaderData<typeof loader>();

  const setView = (v: DashboardView) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === "overview") next.delete("view");
      else next.set("view", v);
      return next;
    });
  };

  const setMonth = (m: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (m) next.set("month", m);
      else next.delete("month");
      return next;
    });
  };

  const isLoading = navigation.state === "loading";
  const showOverview = view === "overview";
  const showMediazioni = view === "mediazioni";
  const showFattureSection = view === "fatture" && showFatture;
  const showMediatori = view === "mediatori";
  const showTassi = view === "tassi";

  if (loaderError) {
    return (
      <div className="alert alert-error">
        <span>{loaderError}</span>
        <Link to="/dashboard" className="btn btn-sm">
          Riprova
        </Link>
      </div>
    );
  }

  return (
    <div aria-busy={isLoading} aria-live="polite">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-base-content">Dashboard</h1>
        <DashboardTabNav view={view} setView={setView} showFatture={!!showFatture} />
      </div>

      {isLoading && (
        <div className="mb-8 flex gap-4">
          <div className="skeleton h-24 flex-1 rounded-lg" />
          <div className="skeleton h-24 flex-1 rounded-lg" />
          <div className="skeleton h-24 flex-1 rounded-lg" />
        </div>
      )}

      {showOverview && !isLoading && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardStatsCard
            title="Mediazioni"
            value={totaleMediazioni}
            href="/mediazioni"
            trend={mediazioniTrend ?? undefined}
          />
        {showFatture && (
          <DashboardStatsCard
            title="Fatture"
            value={totaleFatture}
            href="/fatture"
            trend={incassiTrend ? { delta: incassiTrend.delta, label: incassiTrend.label, formatDelta: formatEuro } : undefined}
          />
        )}
        <div className="card bg-base-100 border border-base-300 p-4 shadow-sm">
          <p className="text-sm font-medium text-base-content/70">Prossimo incontro</p>
          {prossimoIncontro ? (
            <>
              <p className="mt-1 text-base-content">
                {prossimoIncontro.data_inizio
                  ? new Date(prossimoIncontro.data_inizio).toLocaleString("it-IT", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : "—"}
              </p>
              <Link
                to={`/mediazioni/${prossimoIncontro.mediazione_id}?tab=incontri`}
                className="link link-primary mt-2 inline-block text-sm"
              >
                {prossimoIncontro.rgm} →
              </Link>
            </>
          ) : (
            <p className="mt-1 text-base-content/70">Nessun incontro in programma</p>
          )}
        </div>
      </div>
      )}

      <div className="space-y-8">
        {showMediazioni && !isLoading && (
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <h2 className="text-lg font-semibold text-base-content">Mediazioni</h2>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-base-content/70">Mese chiusure:</span>
              <select
                value={monthFilter}
                onChange={(e) => setMonth(e.target.value)}
                className="select select-bordered select-sm"
              >
                <option value="">Tutti</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {formatMonth(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card bg-base-100 border border-base-300 p-4 shadow-sm">
              <h3 className="text-sm font-medium text-base-content mb-4">
                Mediazioni in corso per mediatore
              </h3>
              {mediazioniByMediatore.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mediazioniByMediatore} layout="vertical" margin={{ left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value" name="In corso" fill={CHART_COLORS[0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-base-content/70 text-sm">Nessun dato</p>
              )}
            </div>
            <div className="card bg-base-100 border border-base-300 p-4 shadow-sm">
              <h3 className="text-sm font-medium text-base-content mb-4">
                Mediazioni chiuse per esito{monthFilter ? ` (${formatMonth(monthFilter)})` : ""}
              </h3>
              {closedByEsito.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={closedByEsito}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {closedByEsito.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-base-content/70 text-sm">
                  Nessuna chiusura{monthFilter ? ` in ${formatMonth(monthFilter)}` : ""}
                </p>
              )}
            </div>
            <div className="card bg-base-100 border border-base-300 p-4 shadow-sm">
              <h3 className="text-sm font-medium text-base-content mb-4">
                Mediazioni per mese (ultimi 12)
              </h3>
              {mediazioniByMonth.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mediazioniByMonth.map((d) => ({ ...d, name: formatMonth(d.name) }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" name="Mediazioni" fill={CHART_COLORS[1]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-base-content/70 text-sm">Nessun dato</p>
              )}
            </div>
          </div>
        </section>
        )}

        {showTassi && !isLoading && (
          <section>
            <div className="card bg-base-100 border border-base-300 p-4 shadow-sm">
              <h3 className="text-sm font-medium text-base-content mb-4">
                Tassi mensili (per mese di protocollo)
              </h3>
              <p className="text-xs text-base-content/70 mb-4">
                Tasso adesione: % mediazioni con almeno 1 incontro. Tasso esito positivo: % Accordi tra quelle con incontro.
              </p>
              <TassiChart
                monthlyRates={monthlyRates}
                monthlyRatesByMediatore={monthlyRatesByMediatore}
                isMediatore={isMediatore}
              />
            </div>
          </section>
        )}

        {showMediatori && !isLoading && (
          <section>
            <h2 className="text-lg font-semibold text-base-content mb-4">Mediatori – dettaglio per status</h2>
            <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
              {mediatoreStats.map((m) => (
                <div
                  key={m.mediatore_name}
                  className="card bg-base-100 border border-base-300 p-4 shadow-sm"
                >
                  <h3 className="text-base font-semibold text-base-content mb-4 border-b border-base-300 pb-2">
                    {m.mediatore_name}
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded bg-base-200 px-3 py-2">
                      <span className="text-base-content/70">Aperte</span>
                      <p className="text-lg font-semibold text-base-content">{m.aperte}</p>
                    </div>
                    <div className="rounded bg-base-200 px-3 py-2">
                      <span className="text-base-content/70">In corso</span>
                      <p className="text-lg font-semibold text-base-content">{m.in_corso}</p>
                    </div>
                    <div className="col-span-2 rounded bg-base-200 px-3 py-2">
                      <span className="text-base-content/70">Chiuse</span>
                      <p className="text-lg font-semibold text-base-content">{m.chiuse}</p>
                    </div>
                    <div className="rounded bg-green-50 px-3 py-2">
                      <span className="text-base-content/70">Accordo</span>
                      <p className="font-medium text-green-800">{m.accordo}</p>
                    </div>
                    <div className="rounded bg-amber-50 px-3 py-2">
                      <span className="text-base-content/70">Mancato accordo</span>
                      <p className="font-medium text-amber-800">{m.mancato_accordo}</p>
                    </div>
                    <div className="rounded bg-orange-50 px-3 py-2">
                      <span className="text-base-content/70">Ritirata</span>
                      <p className="font-medium text-orange-800">{m.improcedibile}</p>
                    </div>
                    <div className="rounded bg-base-200 px-3 py-2">
                      <span className="text-base-content/70">Nessuna risposta</span>
                      <p className="font-medium text-base-content">{m.chiusa_ufficio}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {mediatoreStats.length === 0 && (
              <p className="text-base-content/70 text-sm py-4">Nessun mediatore con dati</p>
            )}
          </section>
        )}

        {showFattureSection && !isLoading && (
          <section>
            <h2 className="text-lg font-semibold text-base-content mb-4">Fatture e incassi</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="card bg-base-100 border border-base-300 p-4 shadow-sm">
                <h3 className="text-sm font-medium text-base-content mb-4">
                  Imponibile per mediatore
                </h3>
                {fattureByMediatore.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={fattureByMediatore} layout="vertical" margin={{ left: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(v) => formatEuro(v)} />
                        <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(v: number | undefined) => [formatEuro(v ?? 0), "Imponibile"]} />
                        <Bar dataKey="value" name="Imponibile" fill={CHART_COLORS[2]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-base-content/70 text-sm">Nessun dato</p>
                )}
              </div>
              <div className="card bg-base-100 border border-base-300 p-4 shadow-sm">
                <h3 className="text-sm font-medium text-base-content mb-4">
                  Incassi per mese (ultimi 12)
                </h3>
                {incassiByMonth.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={incassiByMonth.map((d) => ({ ...d, name: formatMonth(d.name) }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => formatEuro(v)} />
                        <Tooltip formatter={(v: number | undefined) => [formatEuro(v ?? 0), "Incassato"]} />
                        <Bar dataKey="value" name="Incassato" fill={CHART_COLORS[3]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-base-content/70 text-sm">Nessun dato</p>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

    </div>
  );
}
