import { useState, useRef, useEffect } from "react";
import { Link, useFetcher, type ShouldRevalidateFunction } from "@remix-run/react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";
import * as XLSX from "xlsx";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { mapFattureWorkbook, type FatturaImportRow } from "~/lib/import-fatture-mapping";
import {
  importFattureRows,
  buildFattureImportIndexes,
  clearFattureImportIndexesCache,
} from "~/lib/import-fatture.server";
import { Upload, FileSpreadsheet, Loader2, ArrowLeft } from "lucide-react";

export const meta: MetaFunction = () => [{ title: "Importa fatture" }];

const IMPORT_BATCH_SIZE = 40;

export const shouldRevalidate: ShouldRevalidateFunction = ({ formMethod, defaultShouldRevalidate }) =>
  formMethod?.toUpperCase() === "POST" ? false : defaultShouldRevalidate;

type ImportProgress = {
  running: boolean;
  total: number;
  done: number;
  success: number;
  updated: number;
  created: number;
  skipped: number;
  errors: { index: number; error: string; rgm?: string; cliente?: string }[];
  inFlight: number;
  message?: string;
};

function chunkRows<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const formData = await request.formData();
  const mode = String(formData.get("mode") ?? "apply");
  const rowsRaw = formData.get("rows");
  let rows: FatturaImportRow[];
  try {
    rows = typeof rowsRaw === "string" ? (JSON.parse(rowsRaw) as FatturaImportRow[]) : [];
  } catch {
    return json({ error: "Dati non validi" }, 400);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: "Nessuna riga da importare" }, 400);
  }

  const forceIndexes = String(formData.get("forceIndexes") ?? "") === "1";
  if (forceIndexes) clearFattureImportIndexesCache();
  const indexes = await buildFattureImportIndexes(pb, { force: forceIndexes });
  const result = await importFattureRows(pb, rows, {
    dryRun: mode === "preview",
    indexes,
  });

  return json({
    ...result,
    mode,
    message:
      mode === "preview"
        ? `Anteprima: ${result.updated} da aggiornare, ${result.created} da creare, ${result.skipped} skip, ${result.errors.length} problemi.`
        : `Import completato: ${result.updated} aggiornate, ${result.created} create, ${result.skipped} skip${
            result.errors.length > 0 ? `, ${result.errors.length} errori` : ""
          }.`,
  });
}

export default function ImportFatture() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedRows, setParsedRows] = useState<FatturaImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [previewResult, setPreviewResult] = useState<{
    success: number;
    updated: number;
    created: number;
    skipped: number;
    errors: { index: number; error: string; rgm?: string; cliente?: string }[];
  } | null>(null);
  const fetcher = useFetcher<typeof action>();

  const queueRef = useRef<FatturaImportRow[][]>([]);
  const statsRef = useRef({
    total: 0,
    done: 0,
    success: 0,
    updated: 0,
    created: 0,
    skipped: 0,
    lastBatch: 0,
    errors: [] as { index: number; error: string; rgm?: string; cliente?: string }[],
  });
  const phaseRef = useRef<"idle" | "preview" | "sent" | "recv">("idle");

  const isImporting = importProgress?.running === true;
  const importDone = importProgress != null && !importProgress.running && importProgress.done > 0;
  const remaining = importProgress ? Math.max(0, importProgress.total - importProgress.done) : 0;
  const progressValue =
    importProgress && importProgress.inFlight > 0
      ? Math.min(importProgress.total, importProgress.done + importProgress.inFlight * 0.5)
      : (importProgress?.done ?? 0);

  function submitBatch(
    batch: FatturaImportRow[],
    mode: "apply" | "preview",
    opts: { forceIndexes?: boolean } = {}
  ) {
    statsRef.current.lastBatch = batch.length;
    phaseRef.current = mode === "preview" ? "preview" : "sent";
    const fd = new FormData();
    fd.set("rows", JSON.stringify(batch));
    fd.set("mode", mode);
    if (opts.forceIndexes) fd.set("forceIndexes", "1");
    fetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data as {
      error?: string;
      mode?: string;
      success?: number;
      updated?: number;
      created?: number;
      skipped?: number;
      errors?: { index: number; error: string; rgm?: string; cliente?: string }[];
      message?: string;
    };
    if (data.error) {
      setImportProgress((prev) =>
        prev
          ? { ...prev, running: false, message: data.error, inFlight: 0 }
          : null
      );
      phaseRef.current = "idle";
      return;
    }

    if (phaseRef.current === "preview") {
      setPreviewResult({
        success: data.success ?? 0,
        updated: data.updated ?? 0,
        created: data.created ?? 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? [],
      });
      phaseRef.current = "idle";
      return;
    }

    if (phaseRef.current !== "sent") return;
    phaseRef.current = "recv";

    const stats = statsRef.current;
    stats.done += stats.lastBatch;
    stats.success += data.success ?? 0;
    stats.updated += data.updated ?? 0;
    stats.created += data.created ?? 0;
    stats.skipped += data.skipped ?? 0;
    if (data.errors?.length) stats.errors.push(...data.errors);

    const next = queueRef.current.shift();
    if (next) {
      setImportProgress({
        running: true,
        total: stats.total,
        done: stats.done,
        success: stats.success,
        updated: stats.updated,
        created: stats.created,
        skipped: stats.skipped,
        errors: stats.errors,
        inFlight: next.length,
      });
      submitBatch(next, "apply");
      return;
    }

    phaseRef.current = "idle";
    setImportProgress({
      running: false,
      total: stats.total,
      done: stats.done,
      success: stats.success,
      updated: stats.updated,
      created: stats.created,
      skipped: stats.skipped,
      errors: stats.errors,
      inFlight: 0,
      message: `Import completato: ${stats.updated} aggiornate, ${stats.created} create, ${stats.skipped} skip${
        stats.errors.length > 0 ? `, ${stats.errors.length} errori` : ""
      }.`,
    });
  }, [fetcher.state, fetcher.data]);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const nameLower = file.name.toLowerCase();
    const isExcel =
      nameLower.endsWith(".xlsx") ||
      nameLower.endsWith(".xls") ||
      nameLower.endsWith(".xlsm");
    if (!isExcel) {
      setParsedRows([]);
      setParseError("Carica un file Excel (.xlsx)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        if (!data) return;
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const sheets = workbook.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name]!, {
            defval: null,
            raw: false,
          }),
        }));
        const rows = mapFattureWorkbook(sheets);
        setParsedRows(rows);
        setParseError(rows.length === 0 ? "Nessuna riga fattura valida nel file" : null);
        setPreviewResult(null);
        setImportProgress(null);
        phaseRef.current = "idle";
        queueRef.current = [];
      } catch {
        setParsedRows([]);
        setParseError("Impossibile leggere il file Excel");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const runPreview = () => {
    if (parsedRows.length === 0 || isImporting) return;
    // Preview on a sample of first 200 + last 50 to keep request light, OR full if small
    const sample =
      parsedRows.length <= 300
        ? parsedRows
        : [...parsedRows.slice(0, 200), ...parsedRows.slice(-50)];
    setPreviewResult(null);
    submitBatch(sample, "preview");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedRows.length === 0 || isImporting) return;
    const batches = chunkRows(parsedRows, IMPORT_BATCH_SIZE);
    if (batches.length === 0) return;
    queueRef.current = batches.slice(1);
    statsRef.current = {
      total: parsedRows.length,
      done: 0,
      success: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      lastBatch: 0,
      errors: [],
    };
    setImportProgress({
      running: true,
      total: parsedRows.length,
      done: 0,
      success: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      errors: [],
      inFlight: batches[0]!.length,
    });
    submitBatch(batches[0]!, "apply", { forceIndexes: true });
  };

  const resetImport = () => {
    setParsedRows([]);
    setParseError(null);
    setPreviewResult(null);
    setImportProgress(null);
    phaseRef.current = "idle";
    queueRef.current = [];
  };

  const sheetCounts = parsedRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.sheet] = (acc[r.sheet] ?? 0) + 1;
    return acc;
  }, {});

  const errorCsv =
    importProgress?.errors?.length || previewResult?.errors?.length
      ? [
          "index,rgm,cliente,error",
          ...(importProgress?.errors ?? previewResult?.errors ?? []).map(
            (e) =>
              `${e.index},"${(e.rgm ?? "").replace(/"/g, '""')}","${(e.cliente ?? "").replace(/"/g, '""')}","${e.error.replace(/"/g, '""')}"`
          ),
        ].join("\n")
      : "";

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/fatture" className="btn btn-ghost btn-sm btn-square" aria-label="Torna alle fatture">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-semibold text-base-content">Importa fatture</h1>
      </div>

      <div className="bg-base-100 rounded-box border border-base-300 p-6 mb-6">
        <p className="text-sm text-base-content/70 mb-4">
          Carica il file Excel: vengono usati solo i fogli{" "}
          <strong>RGM-2023 … RGM-2026</strong> (ignorati “da emettere” / “emesse”).{" "}
          <strong>Upsert</strong>: aggiorna se esiste, altrimenti crea (serve RGM + parte
          già in gestionale).
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm"
          className="hidden"
          onChange={onFileSelected}
          disabled={isImporting}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            <Upload className="h-4 w-4" />
            Carica Excel
          </button>
          {parsedRows.length > 0 && (
            <button type="button" className="btn btn-soft btn-sm" onClick={resetImport} disabled={isImporting}>
              Azzera
            </button>
          )}
        </div>
        {parseError && <p className="text-error text-sm mt-3">{parseError}</p>}
      </div>

      {parsedRows.length > 0 && (
        <div className="bg-base-100 rounded-box border border-base-300 p-6 mb-6">
          <div className="flex items-start gap-3 mb-4">
            <FileSpreadsheet className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{parsedRows.length} righe valide da processare</p>
              <ul className="text-sm text-base-content/70 mt-1">
                {Object.entries(sheetCounts).map(([sheet, n]) => (
                  <li key={sheet}>
                    {sheet}: {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="overflow-x-auto mb-4 max-h-64 border border-base-200 rounded">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>Foglio</th>
                  <th>RGM</th>
                  <th>Cliente</th>
                  <th>N.</th>
                  <th>Emissione</th>
                  <th>Incasso</th>
                  <th>Imponibile</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 30).map((r) => (
                  <tr key={`${r.sheet}-${r.index}`}>
                    <td className="whitespace-nowrap">{r.sheet}</td>
                    <td>{r.rgm}</td>
                    <td>{r.cliente || "—"}</td>
                    <td>{r.numero_fattura || "—"}</td>
                    <td>{r.data_emissione || "—"}</td>
                    <td>{r.data_incasso || "—"}</td>
                    <td>{r.imponibile != null ? `€ ${r.imponibile}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedRows.length > 30 && (
              <p className="text-xs text-base-content/60 px-3 py-2">… e altre {parsedRows.length - 30} righe</p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              className="btn btn-soft btn-sm"
              onClick={runPreview}
              disabled={isImporting || fetcher.state !== "idle"}
            >
              Anteprima match
              {parsedRows.length > 300 ? " (campione)" : ""}
            </button>
            <button type="submit" className="btn btn-primary btn-sm gap-2" disabled={isImporting}>
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Importa fatture ({parsedRows.length})
            </button>
          </form>

          {previewResult && (
            <div className="mt-4 text-sm">
              <p>
                Anteprima: <strong>{previewResult.updated}</strong> da aggiornare,{" "}
                <strong>{previewResult.created}</strong> da creare,{" "}
                <strong>{previewResult.skipped}</strong> skip,{" "}
                <strong>{previewResult.errors.length}</strong> con problema.
              </p>
              {previewResult.errors.length > 0 && (
                <ul className="mt-2 max-h-40 overflow-auto text-xs text-base-content/70 space-y-0.5">
                  {previewResult.errors.slice(0, 40).map((e) => (
                    <li key={`${e.index}-${e.error}`}>
                      [{e.index}] {e.rgm} / {e.cliente}: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {importProgress && (
            <div className="mt-4">
              <progress
                className="progress progress-primary w-full"
                value={progressValue}
                max={importProgress.total}
              />
              <p className="text-sm mt-2 text-base-content/80">
                {isImporting
                  ? `Aggiornamento… ${importProgress.done}/${importProgress.total} (restano ${remaining})`
                  : importProgress.message}
              </p>
              {importDone && (
                <p className="text-sm mt-1">
                  Aggiornate: {importProgress.updated} · Create: {importProgress.created} · Skip:{" "}
                  {importProgress.skipped} · Errori: {importProgress.errors.length}
                </p>
              )}
              {errorCsv && (
                <a
                  className="link link-primary text-sm mt-2 inline-block"
                  href={`data:text/csv;charset=utf-8,${encodeURIComponent(errorCsv)}`}
                  download="fatture-import-skip.csv"
                >
                  Scarica report skip/errori (CSV)
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
