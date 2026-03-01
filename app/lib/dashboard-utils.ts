/** Format YYYY-MM to Italian short month + year (e.g. "gen 25") */
export function formatMonth(name: string): string {
  const [y, m] = name.split("-");
  if (!y || !m) return name;
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1);
  return d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" });
}

const CURRENCY_FORMATTER = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatEuro(value: number): string {
  return CURRENCY_FORMATTER.format(value);
}

export const CHART_COLORS = ["#3aaeba", "#2d8a9e", "#207a8e", "#156a7e", "#0a5a6e"];
export const PIE_COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#64748b"];

export type DashboardView = "overview" | "mediazioni" | "fatture" | "mediatori" | "tassi";
