import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export const EXPORT_FIELDS = [
  { key: "rgm", label: "RGM" },
  { key: "oggetto", label: "Oggetto" },
  { key: "valore", label: "Valore" },
  { key: "istanti", label: "Istanti" },
  { key: "chiamati", label: "Chiamati" },
  { key: "avvocati", label: "Avvocati" },
  { key: "competenza", label: "Competenza" },
  { key: "nota", label: "Nota" },
  { key: "modalita_mediazione", label: "Modalità mediazione" },
  { key: "motivazione_deposito", label: "Motivazione deposito" },
  { key: "modalita_convocazione", label: "Modalità convocazione" },
  { key: "mediatore_name", label: "Mediatore" },
  { key: "esito_finale", label: "Esito" },
  { key: "data_protocollo", label: "Data protocollo" },
  { key: "data_chiusura", label: "Data chiusura" },
  { key: "data_avvio_entro", label: "Data avvio entro" },
] as const;

export type ExportFieldKey = (typeof EXPORT_FIELDS)[number]["key"];

interface ExportMediazioniDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filters: Record<string, string>;
  sortField: string;
  order: string;
}

export function ExportMediazioniDialog({
  isOpen,
  onClose,
  filters,
  sortField,
  order,
}: ExportMediazioniDialogProps) {
  const [selected, setSelected] = useState<ExportFieldKey[]>(EXPORT_FIELDS.map((f) => f.key));

  function toggle(key: ExportFieldKey) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function selectAll() {
    setSelected(EXPORT_FIELDS.map((f) => f.key));
  }

  function selectNone() {
    setSelected([]);
  }

  if (!isOpen) return null;

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  params.set("sort", sortField);
  params.set("order", order);
  selected.forEach((k) => params.append("fields", k));

  const exportUrl = `/mediazioni/export?${params.toString()}`;

  const dialogContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl bg-base-100 shadow-xl flex flex-col overflow-hidden border-2 border-base-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-base-200 px-4 py-3 shrink-0">
          <h2 id="export-dialog-title" className="text-base font-semibold text-base-content">
            Esporta mediazioni
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-base-content/80">
            Seleziona i campi da includere nell&apos;export Excel. Verranno esportate tutte le mediazioni che corrispondono ai filtri attuali.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="btn btn-sm btn-outline"
            >
              Seleziona tutti
            </button>
            <button
              type="button"
              onClick={selectNone}
              className="btn btn-sm btn-outline"
            >
              Deseleziona tutti
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-2">
            {EXPORT_FIELDS.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center gap-2 cursor-pointer hover:bg-base-200/50 rounded-lg px-2 py-1.5"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(key)}
                  onChange={() => toggle(key)}
                  className="checkbox checkbox-sm"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          {selected.length === 0 && (
            <p className="text-sm text-warning">
              Seleziona almeno un campo per esportare.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t-2 border-base-200">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Annulla
          </button>
          <a
            href={selected.length > 0 ? exportUrl : "#"}
            className={`btn btn-primary btn-sm ${selected.length === 0 ? "btn-disabled pointer-events-none" : ""}`}
            onClick={(e) => {
              if (selected.length === 0) e.preventDefault();
              else onClose();
            }}
            download="mediazioni.xlsx"
          >
            Esporta
          </a>
        </div>
      </div>
    </div>
  );

  return createPortal(dialogContent, document.body);
}
