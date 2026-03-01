import { Link } from "@remix-run/react";

type Trend = {
  delta: number;
  label: string;
  /** Optional formatter for delta (e.g. currency) */
  formatDelta?: (n: number) => string;
};

export function DashboardStatsCard({
  title,
  value,
  href,
  hrefLabel,
  trend,
}: {
  title: string;
  value: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  trend?: Trend;
}) {
  const trendUp = trend && trend.delta > 0;
  const trendDown = trend && trend.delta < 0;
  const trendFlat = trend && trend.delta === 0;

  return (
    <div className="card bg-base-100 border border-base-300 p-4 shadow-sm">
      <p className="text-sm font-medium text-base-content/70">{title}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-2xl font-semibold text-base-content">{value}</p>
        {trend && !trendFlat && (
          <span
            className={`text-xs font-medium ${
              trendUp ? "text-success" : trendDown ? "text-error" : "text-base-content/60"
            }`}
            aria-label={`${trendUp ? "+" : ""}${trend.delta} ${trend.label}`}
          >
            {trendUp ? "↑" : "↓"} {trend.formatDelta ? trend.formatDelta(Math.abs(trend.delta)) : Math.abs(trend.delta)} {trend.label}
          </span>
        )}
      </div>
      {trend?.label && trendFlat && (
        <p className="mt-0.5 text-xs text-base-content/60">{trend.label}</p>
      )}
      {href && (
        <Link to={href} className="link link-primary mt-2 inline-block text-sm">
          {hrefLabel ?? "Vai all'elenco"} →
        </Link>
      )}
    </div>
  );
}
