import { useState, useMemo } from "react";

export type RubricaKind = "soggetti" | "avvocati";

export interface RubricaItem {
  id: string;
  display: string;
}

export interface UnisciRubricaDialogProps {
  isOpen: boolean;
  onClose: () => void;
  kind: RubricaKind;
  sourceId: string;
  sourceDisplay: string;
  items: RubricaItem[];
  onConfirm: (targetId: string) => void;
  isSubmitting?: boolean;
}

export function UnisciRubricaDialog({
  isOpen,
  onClose,
  kind,
  sourceId,
  sourceDisplay,
  items,
  onConfirm,
  isSubmitting = false,
}: UnisciRubricaDialogProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const candidates = useMemo(() => items.filter((i) => i.id !== sourceId), [items, sourceId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.toLowerCase().trim();
    return candidates.filter((i) => i.display.toLowerCase().includes(q));
  }, [candidates, search]);

  const handleConfirm = () => {
    if (selectedId) {
      onConfirm(selectedId);
      setSearch("");
      setSelectedId(null);
      onClose();
    }
  };

  const handleClose = () => {
    setSearch("");
    setSelectedId(null);
    onClose();
  };

  if (!isOpen) return null;

  const label = kind === "soggetti" ? "soggetto" : "avvocato";

  return (
    <dialog open className="modal modal-open" aria-labelledby="unisci-rubrica-title">
      <div className="modal-box max-w-lg max-h-[85vh] flex flex-col gap-4">
        <h2 id="unisci-rubrica-title" className="text-lg font-semibold text-base-content">
          Unisci {label} in un altro
        </h2>
        <p className="text-sm text-base-content/80">
          Stai unendo <strong>"{sourceDisplay}"</strong> in un altro {label}. Seleziona la voce corretta in cui unire.
        </p>
        <div>
          <label className="label label-text font-medium">Cerca in rubrica</label>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca nome, PEC…"
            className="input input-bordered input-sm w-full"
            autoFocus
          />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <label className="label label-text font-medium">Seleziona il {label} di destinazione</label>
          <ul className="overflow-auto border border-base-300 rounded-lg divide-y divide-base-200 max-h-[280px]">
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-base-content/60 text-sm">
                Nessuna voce trovata.
              </li>
            ) : (
              filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-base-200 transition-colors ${selectedId === item.id ? "bg-primary/15 text-primary font-medium" : ""}`}
                  >
                    {item.display}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="modal-action flex-wrap gap-2">
          <button type="button" onClick={handleClose} className="btn btn-ghost" disabled={isSubmitting}>
            Annulla
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="btn btn-primary"
            disabled={!selectedId || isSubmitting}
          >
            {isSubmitting ? "Unione in corso…" : "Unisci qui"}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop" onSubmit={handleClose}>
        <button type="submit">chiudi</button>
      </form>
    </dialog>
  );
}
