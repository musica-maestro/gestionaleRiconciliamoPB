import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatMonth } from "~/lib/dashboard-utils";
import { CHART_COLORS } from "~/lib/dashboard-utils";

export type TassiSeries = {
  id: string;
  name: string;
  color: string;
  adesioneKey: string;
  esitoKey: string;
};

type MonthlyRate = { month: string; tassoAdesione: number; tassoEsitoPositivo: number };

type TassiChartProps = {
  monthlyRates: MonthlyRate[];
  monthlyRatesByMediatore: { mediatore_id: string; mediatore_name: string; data: MonthlyRate[] }[];
  isMediatore: boolean;
};

function buildMergedData(
  monthlyRates: TassiChartProps["monthlyRates"],
  monthlyRatesByMediatore: TassiChartProps["monthlyRatesByMediatore"]
) {
  const allMonths = new Set(monthlyRates.map((r) => r.month));
  monthlyRatesByMediatore.forEach((m) => m.data.forEach((d: MonthlyRate) => allMonths.add(d.month)));
  const sortedMonths = [...allMonths].sort().slice(-12);

  return sortedMonths.map((month) => {
    const row: Record<string, string | number | null> = {
      month,
      monthLabel: formatMonth(month),
    };
    const overall = monthlyRates.find((r) => r.month === month);
    if (overall) {
      row.complessivo_adesione = overall.tassoAdesione;
      row.complessivo_esito = overall.tassoEsitoPositivo;
    }
    monthlyRatesByMediatore.forEach((m) => {
      const d = m.data.find((x: MonthlyRate) => x.month === month);
      row[`adesione_${m.mediatore_id}`] = d?.tassoAdesione ?? null;
      row[`esito_${m.mediatore_id}`] = d?.tassoEsitoPositivo ?? null;
    });
    return row;
  });
}

export function TassiChart({
  monthlyRates,
  monthlyRatesByMediatore,
  isMediatore,
}: TassiChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const esitoSeries: TassiSeries[] = [
    {
      id: "complessivo",
      name: isMediatore ? "I tuoi dati" : "Complessivo",
      color: CHART_COLORS[0],
      adesioneKey: "complessivo_adesione",
      esitoKey: "complessivo_esito",
    },
    ...monthlyRatesByMediatore.map((m, i) => ({
      id: m.mediatore_id,
      name: m.mediatore_name,
      color: CHART_COLORS[(i + 1) % CHART_COLORS.length],
      adesioneKey: `adesione_${m.mediatore_id}`,
      esitoKey: `esito_${m.mediatore_id}`,
    })),
  ];

  const mergedData = buildMergedData(monthlyRates, monthlyRatesByMediatore);

  const toggleSeries = (id: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tooltipContent = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; name: string; value: unknown }[]; label?: string }) =>
    active && payload?.length && label ? (
      <div className="rounded-lg border border-base-300 bg-base-100 p-2 shadow-lg text-sm">
        <p className="font-medium mb-2">{label}</p>
        {payload
          .filter((p) => p.value != null)
          .map((p) => (
            <p key={p.dataKey}>
              {p.name}: {p.value}%
            </p>
          ))}
      </div>
    ) : null;

  if (mergedData.length === 0) {
    return <p className="text-base-content/70 text-sm">Nessun dato</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium text-base-content mb-2">Tasso adesione (solo complessivo)</h4>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
              <Tooltip
                formatter={(v: unknown) => (v != null && typeof v === "number" ? `${v}%` : "—")}
                content={tooltipContent}
              />
              <Line
                type="monotone"
                dataKey="complessivo_adesione"
                name={isMediatore ? "I tuoi dati" : "Complessivo"}
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                dot
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-base-content mb-2">Tasso esito positivo (complessivo + per mediatore)</h4>
        {esitoSeries.length > 1 && (
          <div className="flex flex-wrap gap-3 justify-center py-2 border-b border-base-300 mb-2">
            <span className="text-sm text-base-content/70 mr-2">Clicca per nascondere/mostrare:</span>
            {esitoSeries.map((s) => {
              const hidden = hiddenSeries.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSeries(s.id)}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-sm transition-opacity ${
                    hidden ? "opacity-40 line-through" : "opacity-100"
                  } hover:opacity-100`}
                >
                  <span
                    className="inline-block w-4 h-0.5 rounded"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
              <Tooltip
                formatter={(v: unknown) => (v != null && typeof v === "number" ? `${v}%` : "—")}
                content={tooltipContent}
              />
              {esitoSeries.map(
                (s) =>
                  !hiddenSeries.has(s.id) && (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.esitoKey}
                      name={s.name}
                      stroke={s.color}
                      strokeWidth={2}
                      dot
                      connectNulls
                    />
                  )
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
