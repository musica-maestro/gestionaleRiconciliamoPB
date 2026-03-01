import type { DashboardView } from "~/lib/dashboard-utils";

export function DashboardTabNav({
  view,
  setView,
  showFatture,
}: {
  view: DashboardView;
  setView: (v: DashboardView) => void;
  showFatture: boolean;
}) {
  const allTabs: { id: DashboardView; label: string }[] = [
    { id: "overview", label: "Panoramica" },
    { id: "mediazioni", label: "Mediazioni" },
    { id: "fatture", label: "Fatture" },
    { id: "mediatori", label: "Mediatori" },
    { id: "tassi", label: "Tassi" },
  ];
  const tabs = showFatture ? allTabs : allTabs.filter((t) => t.id !== "fatture");

  return (
    <nav
      className="flex overflow-x-auto rounded-lg border border-base-300 bg-base-200/50 p-1"
      aria-label="Vista dashboard"
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={view === tab.id}
          aria-controls={`panel-${tab.id}`}
          id={`tab-${tab.id}`}
          onClick={() => setView(tab.id)}
          className={`btn btn-sm flex-shrink-0 rounded-md px-3 ${
            view === tab.id ? "btn-primary" : "btn-ghost"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
