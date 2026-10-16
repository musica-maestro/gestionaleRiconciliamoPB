import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, type ShouldRevalidateFunction } from "@remix-run/react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";
import * as XLSX from "xlsx";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import {
  mapExcelRowsToAggiornamento,
  type AggiornamentoIssue,
  type AggiornamentoRow,
} from "~/lib/import-aggiornamento-mapping";
import { applyAggiornamentoRows } from "~/lib/import-aggiornamento.server";

export const meta: MetaFunction = () => [{ title: "Aggiornamento raccomandate" }];

const IMPORT_BATCH_SIZE = 40;

export const shouldRevalidate: ShouldRevalidateFunction = ({ formMethod, defaultShouldRevalidate }) =>
  formMethod?.toUpperCase() === "POST" ? false : defaultShouldRevalidate;

type ImportProgress = {
  running: boolean;
  total: number;
  done: number;
  success: number;
  skipped: number;
  mediazioniUpdated: number;
  convocazioniUpdated: number;
  convocazioniCreated: number;
  errors: AggiornamentoIssue[];
  warnings: AggiornamentoIssue[];
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
  const user = await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const formData = await request.formData();
  const mode = String(formData.get("mode") ?? "apply");
  const rowsRaw = formData.get("rows");
  let rows: AggiornamentoRow[];
  try {
    rows = typeof rowsRaw === "string" ? (JSON.parse(rowsRaw) as AggiornamentoRow[]) : [];
  } catch {
    return json({ error: "Dati non validi" }, 400);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: "Nessuna riga da importare" }, 400);
  }

  const result = await applyAggiornamentoRows(pb, rows, {
    dryRun: mode === "preview",
    attoreId: user.id,
  });

  return json({
    ...result,
    mode,
    message:
      mode === "preview"
        ? `Anteprima: ${result.success} aggiornabili, ${result.skipped} skip, ${result.warnings.length} warning, ${result.errors.length} errori.`
        : `Import completato: ${result.success} ok (${result.mediazioniUpdated} mediazioni, ${result.convocazioniUpdated} aggiornate${
            result.convocazioniCreated > 0
              ? `, ${result.convocazioniCreated} create`
              : ""
          })${result.errors.length > 0 ? `, ${result.errors.length} errori` : ""}.`,
  });
}

function downloadIssuesAsExcel(
  issues: AggiornamentoIssue[],
  parsedRows: AggiornamentoRow[],
  filename: string,
) {
  const rowMap = new Map(parsedRows.map((r) => [r.index, r]));
  const data = issues.map((issue) => {
    const original = rowMap.get(issue.index);
    return {
      Riga: issue.index,
      RGM: issue.rgm || original?.rgm || "",
      "Esito raccomandata": original?.esito_raccomandata || "",
      Esito: original?.esito_finale || "",
      "Data chiusura": original?.data_chiusura || "",
      Problema: issue.error,
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Problemi");
  XLSX.writeFile(wb, filename);
}

export default function AggiornamentoGestionaleImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedRows, setParsedRows] = useState<AggiornamentoRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [previewResult, setPreviewResult] = useState<{
    success: number;
    skipped: number;
    errors: AggiornamentoIssue[];
    warnings: AggiornamentoIssue[];
  } | null>(null);
  const fetcher = useFetcher<typeof action>();

  const queueRef = useRef<AggiornamentoRow[][]>([]);
  const modeRef = useRef<"apply" | "preview">("apply");
  const statsRef = useRef({
    total: 0,
    done: 0,
    success: 0,
    skipped: 0,
    lastBatch: 0,
    mediazioniUpdated: 0,
    convocazioniUpdated: 0,
    convocazioniCreated: 0,
    errors: [] as AggiornamentoIssue[],
    warnings: [] as AggiornamentoIssue[],
  });
  const phaseRef = useRef<"idle" | "sent" | "recv">("idle");

  const isImporting = importProgress?.running === true;
  const importDone = importProgress != null && !importProgress.running && importProgress.done > 0;
  const remaining = importProgress ? Math.max(0, importProgress.total - importProgress.done) : 0;
  const progressValue =
    importProgress && importProgress.inFlight > 0
      ? Math.min(importProgress.total, importProgress.done + importProgress.inFlight * 0.5)
      : (importProgress?.done ?? 0);

  function submitBatch(batch: AggiornamentoRow[], mode: "apply" | "preview") {
    statsRef.current.lastBatch = batch.length;
    phaseRef.current = "sent";
    const fd = new FormData();
    fd.set("mode", mode);
    fd.set("rows", JSON.stringify(batch));
    fetcher.submit(fd, { method: "post" });
  }

  function startRun(mode: "apply" | "preview") {
    if (parsedRows.length === 0 || isImporting) return;
    modeRef.current = mode;
    const chunks = chunkRows(parsedRows, IMPORT_BATCH_SIZE);
    const first = chunks.shift();
    if (!first) return;
    queueRef.current = chunks;
    statsRef.current = {
      total: parsedRows.length,
      done: 0,
      success: 0,
      skipped: 0,
      lastBatch: first.length,
      mediazioniUpdated: 0,
      convocazioniUpdated: 0,
      convocazioniCreated: 0,
      errors: [],
      warnings: [],
    };
    setPreviewResult(null);
    setImportProgress({
      running: true,
      total: parsedRows.length,
      done: 0,
      success: 0,
      skipped: 0,
      mediazioniUpdated: 0,
      convocazioniUpdated: 0,
      convocazioniCreated: 0,
      errors: [],
      warnings: [],
      inFlight: first.length,
      message: mode === "preview" ? "Validazione in corso…" : "Import in corso…",
    });
    submitBatch(first, mode);
  }

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (phaseRef.current !== "sent") return;
    phaseRef.current = "recv";

    const data = fetcher.data as {
      error?: string;
      success?: number;
      skipped?: number;
      mediazioniUpdated?: number;
      convocazioniUpdated?: number;
      convocazioniCreated?: number;
      errors?: AggiornamentoIssue[];
      warnings?: AggiornamentoIssue[];
    };

    if (data.error) {
      phaseRef.current = "idle";
      setImportProgress((p) =>
        p
          ? {
              ...p,
              running: false,
              inFlight: 0,
              message: data.error,
              errors: [...p.errors, { index: 0, rgm: "", error: data.error! }],
            }
          : p,
      );
      return;
    }

    const s = statsRef.current;
    s.done += s.lastBatch;
    s.success += data.success ?? 0;
    s.skipped += data.skipped ?? 0;
    s.mediazioniUpdated += data.mediazioniUpdated ?? 0;
    s.convocazioniUpdated += data.convocazioniUpdated ?? 0;
    s.convocazioniCreated += data.convocazioniCreated ?? 0;
    if (Array.isArray(data.errors)) s.errors.push(...data.errors);
    if (Array.isArray(data.warnings)) s.warnings.push(...data.warnings);

    const next = queueRef.current.shift();
    if (next) {
      setImportProgress({
        running: true,
        total: s.total,
        done: s.done,
        success: s.success,
        skipped: s.skipped,
        mediazioniUpdated: s.mediazioniUpdated,
        convocazioniUpdated: s.convocazioniUpdated,
        convocazioniCreated: s.convocazioniCreated,
        errors: s.errors,
        warnings: s.warnings,
        inFlight: next.length,
        message: `Elaborazione ${s.done + 1}–${s.done + next.length} di ${s.total}…`,
      });
      submitBatch(next, modeRef.current);
      return;
    }

    phaseRef.current = "idle";
    const mode = modeRef.current;
    setImportProgress({
      running: false,
      total: s.total,
      done: s.done,
      success: s.success,
      skipped: s.skipped,
      mediazioniUpdated: s.mediazioniUpdated,
      convocazioniUpdated: s.convocazioniUpdated,
      convocazioniCreated: s.convocazioniCreated,
      errors: s.errors,
      warnings: s.warnings,
      inFlight: 0,
      message:
        mode === "preview"
          ? `Anteprima: ${s.success} aggiornabili, ${s.skipped} skip, ${s.warnings.length} warning, ${s.errors.length} errori.`
          : `Import completato: ${s.success} ok (${s.mediazioniUpdated} mediazioni, ${s.convocazioniUpdated} aggiornate${
              s.convocazioniCreated > 0
                ? `, ${s.convocazioniCreated} create`
                : ""
            })${s.errors.length > 0 ? `, ${s.errors.length} errori` : ""}.`,
    });
    if (mode === "preview") {
      setPreviewResult({
        success: s.success,
        skipped: s.skipped,
        errors: s.errors,
        warnings: s.warnings,
      });
    }
  }, [fetcher.state, fetcher.data]);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setPreviewResult(null);
    setImportProgress(null);
    setFileName(file.name);

    const nameLower = file.name.toLowerCase();
    const isExcel =
      nameLower.endsWith(".xlsx") ||
      nameLower.endsWith(".xls") ||
      nameLower.endsWith(".xlsm") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";

    if (!isExcel) {
      setParsedRows([]);
      setParseError("Carica un file Excel (.xlsx / .xls)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        if (!data || !(data instanceof ArrayBuffer)) return;
        // cellDates:false → serial numerici (niente shift TZ Italia/UTC)
        const workbook = XLSX.read(data, { type: "array", cellDates: false });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]!];
        if (!firstSheet) {
          setParsedRows([]);
          setParseError("Foglio Excel vuoto");
          return;
        }
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
          defval: "",
          raw: true,
        });
        const mapped = mapExcelRowsToAggiornamento(jsonRows);
        if (mapped.length === 0) {
          setParsedRows([]);
          setParseError("Nessuna riga valida nel file (attese colonne RGM, Esito raccomandata, Esito, Data chiusura)");
          return;
        }
        setParsedRows(mapped);
      } catch {
        setParsedRows([]);
        setParseError("Impossibile leggere il file Excel");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-2">
      <div className="mb-2">
        <Link
          to="/mediazioni"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Elenco mediazioni
        </Link>
      </div>

      <h1 className="text-xl font-semibold mb-1">Aggiornamento raccomandate</h1>
      <p className="text-sm text-slate-500 mb-4">
        File Excel con colonne <strong>RGM</strong>, <strong>Esito raccomandata</strong>,{" "}
        <strong>Esito</strong>, <strong>Data chiusura</strong>. Aggiorna la mediazione e la
        convocazione Raccomandata del chiamato; se non esiste, ne crea una contestuale (senza
        data invio né numero). Se ce n&apos;è più di una, prende l&apos;ultima senza esito /
        più recente.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={onFileSelected}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          className="btn btn-primary gap-2"
        >
          <Upload className="w-4 h-4" />
          Carica Excel
        </button>
        {parsedRows.length > 0 && (
          <span className="text-sm text-slate-500">
            {parsedRows.length} righe caricate
            {fileName ? ` · ${fileName}` : ""}
          </span>
        )}
      </div>

      {parseError && (
        <div className="alert alert-error mb-4">
          <span>{parseError}</span>
        </div>
      )}

      {importProgress?.message && (
        <div
          className={`alert mb-4 ${
            importProgress.errors.length > 0
              ? "alert-warning"
              : importDone
                ? "alert-success"
                : "alert-info"
          }`}
        >
          <span>{importProgress.message}</span>
        </div>
      )}

      {isImporting && importProgress && (
        <div className="mb-4">
          <progress
            className="progress progress-primary w-full"
            value={progressValue}
            max={importProgress.total}
          />
          <p className="text-xs text-slate-500 mt-1">
            {importProgress.done} / {importProgress.total}
            {remaining > 0 ? ` · restano ${remaining}` : ""}
          </p>
        </div>
      )}

      {parsedRows.length > 0 && (
        <div className="mb-4 overflow-auto max-h-[48vh] border border-slate-200 rounded-lg">
          <table className="table table-zebra table-pin-rows table-sm">
            <thead>
              <tr>
                <th>#</th>
                <th>RGM</th>
                <th>Esito raccomandata</th>
                <th>Esito</th>
                <th>Data chiusura</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.slice(0, 200).map((row) => (
                <tr key={`${row.index}-${row.rgm}`}>
                  <td>{row.index}</td>
                  <td>{row.rgm || "—"}</td>
                  <td>{row.esito_raccomandata || "—"}</td>
                  <td>{row.esito_finale || "—"}</td>
                  <td>{row.data_chiusura || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {parsedRows.length > 200 && (
            <p className="text-xs text-slate-500 p-2">
              Anteprima prime 200 di {parsedRows.length} righe
            </p>
          )}
        </div>
      )}

      {(previewResult || (importDone && importProgress)) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {(previewResult?.errors.length || importProgress?.errors.length) ? (
            <div className="border border-warning/40 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-warning/20">
                <p className="text-xs font-medium text-warning">
                  {(previewResult?.errors.length ?? importProgress?.errors.length) || 0} errori
                </p>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost gap-1"
                  onClick={() =>
                    downloadIssuesAsExcel(
                      previewResult?.errors ?? importProgress?.errors ?? [],
                      parsedRows,
                      "aggiornamento_errori.xlsx",
                    )
                  }
                >
                  <Download className="w-3 h-3" />
                  Scarica
                </button>
              </div>
              <div className="max-h-40 overflow-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Riga</th>
                      <th>RGM</th>
                      <th>Problema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewResult?.errors ?? importProgress?.errors ?? [])
                      .slice(0, 50)
                      .map((e) => (
                        <tr key={`err-${e.index}-${e.error}`}>
                          <td>{e.index}</td>
                          <td>{e.rgm || "—"}</td>
                          <td>{e.error}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {(previewResult?.warnings.length || importProgress?.warnings.length) ? (
            <div className="border border-info/40 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-info/20">
                <p className="text-xs font-medium text-info">
                  {(previewResult?.warnings.length ?? importProgress?.warnings.length) || 0}{" "}
                  warning (senza chiamato)
                </p>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost gap-1"
                  onClick={() =>
                    downloadIssuesAsExcel(
                      previewResult?.warnings ?? importProgress?.warnings ?? [],
                      parsedRows,
                      "aggiornamento_warning.xlsx",
                    )
                  }
                >
                  <Download className="w-3 h-3" />
                  Scarica
                </button>
              </div>
              <div className="max-h-40 overflow-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Riga</th>
                      <th>RGM</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewResult?.warnings ?? importProgress?.warnings ?? [])
                      .slice(0, 50)
                      .map((e) => (
                        <tr key={`warn-${e.index}-${e.error}`}>
                          <td>{e.index}</td>
                          <td>{e.rgm || "—"}</td>
                          <td>{e.error}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {parsedRows.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => startRun("preview")}
            disabled={isImporting}
            className="btn btn-outline gap-2"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Elaborazione…
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4" />
                Anteprima / valida
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => startRun("apply")}
            disabled={isImporting}
            className="btn btn-warning gap-2"
          >
            Conferma aggiornamento
          </button>
          <button
            type="button"
            onClick={() => {
              setParsedRows([]);
              setFileName(null);
              setPreviewResult(null);
              setImportProgress(null);
            }}
            disabled={isImporting}
            className="btn btn-ghost"
          >
            Scegli altro file
          </button>
        </div>
      )}
    </div>
  );
}
