import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";

interface ExportFlussoNotificheDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filters: Record<string, string>;
  totalHint?: number;
}

const PHASE_LABEL: Record<string, string> = {
  check: "Verifica",
  generate: "Generazione PDF",
  mail: "Mail avvocati",
};

export function ExportFlussoNotificheDialog({
  isOpen,
  onClose,
  filters,
  totalHint,
}: ExportFlussoNotificheDialogProps) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{
    phase: string;
    current: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetAndClose = () => {
    if (exporting) return;
    setError(null);
    setSummary(null);
    setProgress(null);
    onClose();
  };

  const submit = async () => {
    setExporting(true);
    setError(null);
    setSummary(null);
    setProgress(null);
    try {
      const formData = new FormData();
      Object.entries(filters).forEach(([k, v]) => {
        if (v) formData.append(k, v);
      });
      const res = await fetch("/mediazioni/flusso-export", { method: "POST", body: formData });
      if (!res.ok && !res.body) {
        setError(`Errore export (status ${res.status})`);
        return;
      }

      const streamProgress = res.headers.get("X-Export-Stream") === "progress+zip" && res.body;
      if (!streamProgress) {
        const text = await res.text();
        setError(text || `Errore export (status ${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let byteBuffer = new Uint8Array(0);
      let zipFilename: string | null = null;
      let zipLength: number | null = null;
      const zipChunks: Uint8Array[] = [];
      let zipBytesCollected = 0;
      let okCount: number | null = null;
      let mailCount: number | null = null;
      let totalCount: number | null = null;
      let sawError = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (zipLength !== null) {
          const needed = zipLength - zipBytesCollected;
          if (value.length <= needed) {
            zipChunks.push(value);
            zipBytesCollected += value.length;
          } else {
            zipChunks.push(value.subarray(0, needed));
            zipBytesCollected = zipLength;
          }
          if (zipBytesCollected >= zipLength) break;
          continue;
        }
        const combined = new Uint8Array(byteBuffer.length + value.length);
        combined.set(byteBuffer);
        combined.set(value, byteBuffer.length);
        byteBuffer = combined;

        let newlineIdx = byteBuffer.indexOf(0x0a);
        while (newlineIdx !== -1) {
          const lineBytes = byteBuffer.subarray(0, newlineIdx);
          byteBuffer = byteBuffer.subarray(newlineIdx + 1);
          const line = decoder.decode(lineBytes).trim();
          if (line) {
            try {
              const obj = JSON.parse(line) as {
                type: string;
                phase?: string;
                current?: number;
                total?: number;
                length?: number;
                filename?: string;
                message?: string;
                okCount?: number;
                mailCount?: number;
              };
              if (
                obj.type === "progress" &&
                typeof obj.current === "number" &&
                typeof obj.total === "number"
              ) {
                setProgress({
                  phase: obj.phase ?? "generate",
                  current: obj.current,
                  total: obj.total,
                });
              } else if (obj.type === "zip" && typeof obj.length === "number" && obj.filename) {
                zipLength = obj.length;
                zipFilename = obj.filename;
                okCount = obj.okCount ?? null;
                mailCount = obj.mailCount ?? null;
                totalCount = typeof obj.total === "number" ? obj.total : null;
                if (byteBuffer.length > 0) {
                  const take = Math.min(byteBuffer.length, zipLength);
                  zipChunks.push(byteBuffer.subarray(0, take));
                  zipBytesCollected = take;
                  byteBuffer = byteBuffer.subarray(take);
                }
                if (zipBytesCollected >= zipLength) {
                  newlineIdx = -1;
                  break;
                }
              } else if (obj.type === "error" && obj.message) {
                sawError = true;
                setError(obj.message);
                return;
              }
            } catch {
              // ignore malformed lines
            }
          }
          if (zipLength !== null) break;
          newlineIdx = byteBuffer.indexOf(0x0a);
        }
        if (zipLength !== null && zipBytesCollected >= zipLength) break;
      }

      if (sawError) return;

      if (!zipFilename || zipLength === null || zipBytesCollected < zipLength) {
        setError("Export interrotto: nessun ZIP restituito.");
        return;
      }

      const blob = new Blob(zipChunks as BlobPart[], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setSummary(
        `Export completato: ${okCount ?? "?"} PDF` +
          (totalCount != null ? ` su ${totalCount}` : "") +
          (mailCount != null ? `, ${mailCount} mail avvocati` : "") +
          ".",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const phaseLabel = progress ? PHASE_LABEL[progress.phase] ?? progress.phase : null;

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="flusso-notifiche-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      onClick={resetAndClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-base-300 bg-base-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-base-200 px-5 py-4">
          <div>
            <h3 id="flusso-notifiche-title" className="font-semibold text-base-content">
              Esporta Flusso (ZIP)
            </h3>
            <p className="mt-1 text-sm text-base-content/65">
              Prima verifica tutte le pratiche, poi genera PDF e mail. Se qualcosa
              non va, l&apos;export si ferma e non scarica lo ZIP.
              {typeof totalHint === "number" ? ` (${totalHint} pratiche)` : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={resetAndClose}
            disabled={exporting}
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {progress && (
            <div>
              <p className="text-xs text-base-content/60 mb-1">
                {phaseLabel} {progress.current} / {progress.total}
              </p>
              <progress
                className="progress progress-primary w-full h-2"
                value={progress.current}
                max={Math.max(1, progress.total)}
              />
            </div>
          )}
          {error && (
            <div className="alert alert-error py-2 text-sm max-h-56 overflow-y-auto whitespace-pre-wrap">
              {error}
            </div>
          )}
          {summary && !error && (
            <div className="alert alert-success py-2 text-sm">{summary}</div>
          )}
          {!exporting && !summary && !error && (
            <p className="text-sm text-base-content/70">
              Lo stato delle pratiche non cambia: lo ZIP va ricaricato e smistato
              manualmente.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-base-200 px-5 py-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetAndClose} disabled={exporting}>
            {summary || error ? "Chiudi" : "Annulla"}
          </button>
          {!summary && !error && (
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              onClick={submit}
              disabled={exporting}
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Esportazione…" : "Avvia export"}
            </button>
          )}
          {error && !exporting && (
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              onClick={submit}
            >
              <Download className="h-3.5 w-3.5" />
              Riprova
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
