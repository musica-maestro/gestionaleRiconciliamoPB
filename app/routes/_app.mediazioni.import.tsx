import { useState, useRef, useEffect } from "react";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import * as XLSX from "xlsx";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { mapExcelWorkbookToImport, type ImportRow } from "~/lib/import-mediazioni-mapping";
import { importRows } from "~/lib/import-mediazioni.server";
import { Upload, FileSpreadsheet, Loader2, ExternalLink, UserCheck, UserPlus } from "lucide-react";

export const meta = () => [{ title: "Importa mediazioni" }];

/** Chunk size so the UI can show live progress during import. */
const IMPORT_BATCH_SIZE = 5;

type ImportProgress = {
  running: boolean;
  total: number;
  done: number;
  success: number;
  errors: { index: number; error: string }[];
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
  const { pb } = await createPB(request);
  const soggetti = await pb
    .collection("soggetti")
    .getFullList({
      fields: "id,nome,cognome,codice_fiscale,indirizzo_riga_1,comune,provincia,cap,ragione_sociale",
      sort: "cognome,nome",
    })
    .catch(() => []);
  return json({
    soggetti: soggetti as Array<{
      id: string;
      nome?: string;
      cognome?: string;
      codice_fiscale?: string;
      ragione_sociale?: string;
      indirizzo_riga_1?: string;
      comune?: string;
      provincia?: string;
      cap?: string;
    }>,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);
  if (!user?.id) throw redirect("/login");

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const formData = await request.formData();
  const rowsRaw = formData.get("rows");
  let rows: ImportRow[];
  try {
    rows = typeof rowsRaw === "string" ? (JSON.parse(rowsRaw) as ImportRow[]) : [];
  } catch {
    return json({ error: "Dati non validi" }, 400);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: "Nessuna riga da importare" }, 400);
  }

  const users = await pb.collection("users").getFullList({ fields: "id,name" });
  const userNameToId: Record<string, string> = {};
  for (const u of users as { id: string; name?: string }[]) {
    if (u.name) userNameToId[u.name] = u.id;
  }

  const { success, errors } = await importRows(pb, rows, user.id, userNameToId);

  return json({
    success,
    errors,
    message: `Import completato: ${success} create/aggiornate${errors.length > 0 ? `, ${errors.length} errori` : ""}.`,
  });
}

function getIstanteLabel(row: ImportRow): string {
  const n = row.parteIstante.nome;
  const c = row.parteIstante.cognome;
  return [n, c].filter(Boolean).join(" ") || "—";
}

function getChiamatoLabel(row: ImportRow): string {
  const n = row.parteChiamato.nome;
  const c = row.parteChiamato.cognome;
  return [n, c].filter(Boolean).join(" ") || "—";
}

/** Formatta una data in italiano (g/m/aaaa). Accetta YYYY-MM-DD. */
function formatDateIT(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  const s = value.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${Number(d)}/${Number(m)}/${y}`;
  }
  return s;
}

type SoggettoMatch = { id: string; inDb: true } | { inDb: false };
function matchSoggetto(
  soggetti: Array<{ id: string; nome?: string; cognome?: string; codice_fiscale?: string; ragione_sociale?: string }>,
  parte: { nome: string; cognome: string; codice_fiscale: string }
): SoggettoMatch {
  const cf = (parte.codice_fiscale || "").trim().toUpperCase();
  if (cf && !/^(N\.?D\.?|NA|\?+|X+)$/i.test(cf)) {
    const byCf = soggetti.find(
      (s) => (s.codice_fiscale || "").trim().toUpperCase() === cf
    );
    if (byCf) return { id: byCf.id, inDb: true };
  }
  const full = [parte.nome, parte.cognome].filter(Boolean).join(" ").trim().toLowerCase();
  if (full) {
    const byRs = soggetti.find((s) => (s.ragione_sociale || "").trim().toLowerCase() === full);
    if (byRs) return { id: byRs.id, inDb: true };
  }
  const nome = (parte.nome || "").trim().toLowerCase();
  const cognome = (parte.cognome || "").trim().toLowerCase();
  if (nome || cognome) {
    const byName = soggetti.find((s) => {
      const sn = (s.nome || "").trim().toLowerCase();
      const sc = (s.cognome || "").trim().toLowerCase();
      return sn === nome && sc === cognome;
    });
    if (byName) return { id: byName.id, inDb: true };
  }
  return { inDb: false };
}

export default function ImportMediazioni() {
  const loaderData = useLoaderData<typeof loader>();
  const soggetti = loaderData?.soggetti ?? [];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [detectedFormat, setDetectedFormat] = useState<"check" | "tracciato" | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const fetcher = useFetcher<typeof action>();

  const queueRef = useRef<ImportRow[][]>([]);
  const statsRef = useRef({ total: 0, done: 0, success: 0, lastBatch: 0, errors: [] as { index: number; error: string }[] });
  const phaseRef = useRef<"idle" | "sent" | "recv">("idle");

  const isImporting = importProgress?.running === true;
  const importDone = importProgress != null && !importProgress.running && importProgress.done > 0;
  const remaining = importProgress
    ? Math.max(0, importProgress.total - importProgress.done)
    : 0;
  const progressValue =
    importProgress && importProgress.inFlight > 0
      ? Math.min(importProgress.total, importProgress.done + importProgress.inFlight * 0.5)
      : (importProgress?.done ?? 0);

  function submitBatch(batch: ImportRow[]) {
    statsRef.current.lastBatch = batch.length;
    phaseRef.current = "sent";
    setImportProgress((prev) =>
      prev
        ? { ...prev, running: true, inFlight: batch.length }
        : {
            running: true,
            total: statsRef.current.total,
            done: 0,
            success: 0,
            errors: [],
            inFlight: batch.length,
          }
    );
    fetcher.submit(
      { rows: JSON.stringify(batch) },
      { method: "post", action: "/mediazioni/import" }
    );
  }

  useEffect(() => {
    if (phaseRef.current === "sent" && fetcher.state !== "idle") {
      phaseRef.current = "recv";
    }
    if (phaseRef.current !== "recv") return;
    if (fetcher.state !== "idle") return;

    const data = fetcher.data;
    if (!data) return;

    const stats = statsRef.current;
    stats.done = Math.min(stats.total, stats.done + stats.lastBatch);

    if ("error" in data && data.error && !("success" in data)) {
      phaseRef.current = "idle";
      queueRef.current = [];
      const message = String(data.error);
      setImportProgress({
        running: false,
        total: stats.total,
        done: stats.done,
        success: stats.success,
        errors: [...stats.errors, { index: -1, error: message }],
        inFlight: 0,
        message,
      });
      return;
    }

    if ("success" in data) {
      stats.success += Number(data.success) || 0;
      const batchErrors =
        "errors" in data && Array.isArray(data.errors)
          ? (data.errors as { index: number; error: string }[])
          : [];
      stats.errors = [...stats.errors, ...batchErrors];
    }

    const next = queueRef.current.shift();
    if (next) {
      setImportProgress({
        running: true,
        total: stats.total,
        done: stats.done,
        success: stats.success,
        errors: stats.errors,
        inFlight: next.length,
      });
      submitBatch(next);
      return;
    }

    phaseRef.current = "idle";
    const message = `Import completato: ${stats.success} create/aggiornate${
      stats.errors.length > 0 ? `, ${stats.errors.length} errori` : ""
    }.`;
    setImportProgress({
      running: false,
      total: stats.total,
      done: stats.done,
      success: stats.success,
      errors: stats.errors,
      inFlight: 0,
      message,
    });
  }, [fetcher.state, fetcher.data]);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const nameLower = file.name.toLowerCase();
    const isExcel =
      nameLower.endsWith(".xlsx") ||
      nameLower.endsWith(".xls") ||
      nameLower.endsWith(".xlsm") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel" ||
      file.type === "application/vnd.ms-excel.sheet.macroEnabled.12" ||
      file.type === "application/vnd.ms-excel.sheet.macroenabled.12";

    if (!isExcel) {
      setParsedRows([]);
      setDetectedFormat(null);
      setImportProgress(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        if (!data) return;
        // ArrayBuffer is more reliable than binary string for .xlsm
        const workbook = XLSX.read(data, { type: "array", cellDates: false });
        const sheetNames = workbook.SheetNames;
        const mediazioniName =
          sheetNames.find((n) => n.trim().toLowerCase() === "mediazioni") ||
          sheetNames[0];
        const trasmessiName = sheetNames.find(
          (n) => n.trim().toLowerCase() === "trasmessi"
        );
        const mediazioniSheet = workbook.Sheets[mediazioniName!];
        const mediazioniRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          mediazioniSheet,
          { defval: "", raw: true }
        );
        const trasmessiRows = trasmessiName
          ? XLSX.utils.sheet_to_json<Record<string, unknown>>(
              workbook.Sheets[trasmessiName],
              { defval: "", raw: true }
            )
          : null;
        const rows = mapExcelWorkbookToImport({
          mediazioniRows,
          trasmessiRows,
        });
        setParsedRows(rows);
        setDetectedFormat(rows[0]?.sourceFormat === "check" ? "check" : "tracciato");
        setImportProgress(null);
        phaseRef.current = "idle";
        queueRef.current = [];
      } catch {
        setParsedRows([]);
        setDetectedFormat(null);
        setImportProgress(null);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
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
      lastBatch: 0,
      errors: [],
    };
    setImportProgress({
      running: true,
      total: parsedRows.length,
      done: 0,
      success: 0,
      errors: [],
      inFlight: batches[0]!.length,
    });
    submitBatch(batches[0]!);
  };

  const resetImport = () => {
    setParsedRows([]);
    setDetectedFormat(null);
    setImportProgress(null);
    phaseRef.current = "idle";
    queueRef.current = [];
  };

  return (
    <div className="mx-auto max-w-[100rem] w-full px-4 py-6">
      <div className="mb-6">
        <Link
          to="/mediazioni"
          className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
        >
          ← Elenco mediazioni
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-slate-800 mb-2">Importa mediazioni</h1>
      <p className="text-slate-600 mb-6">
        Carica un Excel nel formato <strong>Tracciato Organismo</strong> oppure{" "}
        <strong>Check Mediazioni</strong> (fogli Mediazioni + Trasmessi). Anteprima prima
        dell&apos;import nel database.
      </p>

      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm"
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
          Carica file Excel
        </button>
        {parsedRows.length > 0 && (
          <span className="ml-3 text-sm text-slate-500">
            {parsedRows.length} righe pronte
            {detectedFormat === "check"
              ? " (formato Check Mediazioni)"
              : detectedFormat === "tracciato"
                ? " (Tracciato Organismo)"
                : ""}
          </span>
        )}
      </div>

      {parsedRows.length > 0 && (
        <>
          <p className="text-sm text-slate-600 mb-2">
            {detectedFormat === "check" ? (
              <>
                Formato Check: aggiorna per RGM data iscrizione/chiusura, esito, mediatore,
                link (istanza / adesione / chiusura) e flag <em>trasmessa</em> dal foglio
                Trasmessi. Istante/Chiamato senza CF non ricreano soggetti se la mediazione
                esiste già.
              </>
            ) : (
              <>
                Controlla i dati qui sotto. Istante/Chiamato in DB verranno riutilizzati (campi
                vuoti aggiornati dall&apos;Excel). Link Istanza e Cartella &rarr; documenti. Data
                e ora incontro &rarr; record in Incontri.
              </>
            )}
          </p>

          {importProgress?.message && !isImporting && (
            <div
              className={`alert mb-3 ${
                importProgress.errors.length > 0 ? "alert-warning" : "alert-success"
              }`}
            >
              <span>{importProgress.message}</span>
            </div>
          )}

          {isImporting && importProgress && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 space-y-1.5 mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-base-content flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  Importazione in corso…
                </span>
                <span className="tabular-nums text-base-content/80">
                  {importProgress.done} / {importProgress.total}
                  {remaining > 0 ? ` · ne mancano ${remaining}` : ""}
                </span>
              </div>
              <progress
                className="progress progress-primary w-full h-2"
                value={progressValue}
                max={Math.max(1, importProgress.total)}
              />
              <p className="text-xs text-base-content/55">
                Aggiornate/create {importProgress.success}
                {importProgress.inFlight > 0
                  ? ` · in lavorazione ${importProgress.done + 1}–${Math.min(
                      importProgress.total,
                      importProgress.done + importProgress.inFlight
                    )}`
                  : ""}
                {importProgress.errors.length > 0
                  ? ` · ${importProgress.errors.length} errori finora`
                  : ""}
              </p>
            </div>
          )}

          <div className="border border-base-200 rounded-lg overflow-hidden -mx-4 sm:-mx-6 lg:-mx-8">
            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-320px)]">
              <table className="table table-sm table-zebra w-full min-w-[2200px] [&_td]:align-top">
                <thead className="sticky top-0 z-10 bg-base-200 shadow-sm">
                  <tr>
                    <th className="min-w-[36px]">#</th>
                    <th className="min-w-[110px]">RGM</th>
                    <th className="min-w-[110px]">
                      {detectedFormat === "check" ? "Data iscrizione" : "Data deposito"}
                    </th>
                    {detectedFormat === "check" ? (
                      <>
                        <th className="min-w-[110px]">Data chiusura</th>
                        <th className="min-w-[140px]">Esito</th>
                        <th className="min-w-[90px]">Trasmessa</th>
                      </>
                    ) : (
                      <>
                        <th className="min-w-[110px]">Data protocollo</th>
                        <th className="min-w-[140px]">Incontro (data &middot; ora)</th>
                      </>
                    )}
                    <th className="min-w-[120px]">Mediatore</th>
                    <th className="min-w-[190px]">Istante</th>
                    <th className="min-w-[190px]">Avvocato</th>
                    <th className="min-w-[190px]">Chiamato</th>
                    {detectedFormat !== "check" && (
                      <>
                        <th className="min-w-[210px]">Oggetto / Materia</th>
                        <th className="min-w-[150px]">Valore</th>
                        <th className="min-w-[100px]">Competenza</th>
                        <th className="min-w-[120px]">Modalità</th>
                        <th className="min-w-[210px]">Modalità conv.</th>
                        <th className="min-w-[210px]">Motivazione deposito</th>
                      </>
                    )}
                    <th className="min-w-[120px]">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row) => {
                    const istanteMatch = matchSoggetto(soggetti, row.parteIstante);
                    const chiamatoMatch = matchSoggetto(soggetti, row.parteChiamato);
                    const linkIstanza = (row.mediazionePayload.link_istanza || "").trim();
                    const linkCartella = (row.mediazionePayload.link_cartella || "").trim();
                    const linkAdesione = (row.mediazionePayload.link_adesione || "").trim();
                    const linkChiusura = (
                      row.mediazionePayload.link_documento_chiusura || ""
                    ).trim();
                    const isUrl = (s: string) =>
                      s.startsWith("http://") || s.startsWith("https://");
                    const avvLabel = [row.avvocatoIstante.nome, row.avvocatoIstante.cognome]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <tr key={row.index}>
                        <td className="py-2">{row.index}</td>
                        <td className="py-2 font-medium whitespace-nowrap">
                          {row.mediazionePayload.rgm || "—"}
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          {formatDateIT(row.mediazionePayload.data_deposito)}
                        </td>
                        {detectedFormat === "check" ? (
                          <>
                            <td className="py-2 whitespace-nowrap">
                              {formatDateIT(row.mediazionePayload.data_chiusura)}
                            </td>
                            <td className="py-2 whitespace-nowrap">
                              {row.mediazionePayload.esito_finale || "—"}
                            </td>
                            <td className="py-2 whitespace-nowrap">
                              {row.mediazionePayload.trasmessa_set
                                ? row.mediazionePayload.trasmessa
                                  ? "Sì"
                                  : "No"
                                : "—"}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 whitespace-nowrap">
                              {formatDateIT(row.mediazionePayload.data_protocollo)}
                            </td>
                            <td className="py-2 whitespace-nowrap">
                              {row.mediazionePayload.data_incontro ? (
                                <span className="text-sm">
                                  {formatDateIT(row.mediazionePayload.data_incontro)}
                                  {row.mediazionePayload.ora_incontro && (
                                    <> &middot; {row.mediazionePayload.ora_incontro}</>
                                  )}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </>
                        )}
                        <td className="py-2 max-w-[140px]">
                          <span className="block truncate">
                            {row.mediazionePayload.mediatore || "—"}
                          </span>
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="truncate max-w-[130px] block">
                              {getIstanteLabel(row) || "—"}
                            </span>
                            {istanteMatch.inDb ? (
                              <span
                                className="badge badge-sm badge-info shrink-0 gap-0.5"
                                title="Già in rubrica"
                              >
                                <UserCheck className="w-3 h-3" /> DB
                              </span>
                            ) : (
                              <span
                                className="badge badge-sm badge-ghost shrink-0 gap-0.5"
                                title="Nuovo soggetto"
                              >
                                <UserPlus className="w-3 h-3" /> Nuovo
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 max-w-[190px]">
                          <span className="block truncate">{avvLabel || "—"}</span>
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="truncate max-w-[130px] block">
                              {getChiamatoLabel(row) || "—"}
                            </span>
                            {chiamatoMatch.inDb ? (
                              <span
                                className="badge badge-sm badge-info shrink-0 gap-0.5"
                                title="Già in rubrica"
                              >
                                <UserCheck className="w-3 h-3" /> DB
                              </span>
                            ) : (
                              <span
                                className="badge badge-sm badge-ghost shrink-0 gap-0.5"
                                title="Nuovo soggetto"
                              >
                                <UserPlus className="w-3 h-3" /> Nuovo
                              </span>
                            )}
                          </span>
                        </td>
                        {detectedFormat !== "check" && (
                          <>
                            <td className="py-2 max-w-[220px]">
                              <span className="block truncate">
                                {row.mediazionePayload.oggetto || "—"}
                              </span>
                            </td>
                            <td className="py-2 max-w-[160px]">
                              <span className="block truncate">
                                {row.mediazionePayload.valore || "—"}
                              </span>
                            </td>
                            <td className="py-2 max-w-[110px]">
                              <span className="block truncate">
                                {row.mediazionePayload.competenza || "—"}
                              </span>
                            </td>
                            <td className="py-2 max-w-[130px]">
                              <span className="block truncate">
                                {row.mediazionePayload.modalita_mediazione || "—"}
                              </span>
                            </td>
                            <td className="py-2 max-w-[220px]">
                              <span className="block truncate">
                                {row.mediazionePayload.modalita_convocazione || "—"}
                              </span>
                            </td>
                            <td className="py-2 max-w-[220px]">
                              <span className="block truncate">
                                {row.mediazionePayload.motivazione_deposito || "—"}
                              </span>
                            </td>
                          </>
                        )}
                        <td className="py-2">
                          <div className="flex flex-col gap-1">
                            {linkIstanza && isUrl(linkIstanza) ? (
                              <a
                                href={linkIstanza}
                                target="_blank"
                                rel="noreferrer"
                                className="link link-primary text-xs inline-flex items-center gap-0.5"
                              >
                                Istanza <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : null}
                            {linkCartella && isUrl(linkCartella) ? (
                              <a
                                href={linkCartella}
                                target="_blank"
                                rel="noreferrer"
                                className="link link-primary text-xs inline-flex items-center gap-0.5"
                              >
                                Cartella <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : null}
                            {linkAdesione && isUrl(linkAdesione) ? (
                              <a
                                href={linkAdesione}
                                target="_blank"
                                rel="noreferrer"
                                className="link link-primary text-xs inline-flex items-center gap-0.5"
                              >
                                Adesione <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : null}
                            {linkChiusura && isUrl(linkChiusura) ? (
                              <a
                                href={linkChiusura}
                                target="_blank"
                                rel="noreferrer"
                                className="link link-primary text-xs inline-flex items-center gap-0.5"
                              >
                                Chiusura <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : null}
                            {!isUrl(linkIstanza) &&
                              !isUrl(linkCartella) &&
                              !isUrl(linkAdesione) &&
                              !isUrl(linkChiusura) &&
                              "—"}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 py-3 px-4 border-t border-base-200 bg-base-200">
              <p className="text-sm text-base-content/70">
                {isImporting && importProgress
                  ? `${importProgress.done} / ${importProgress.total} righe elaborate`
                  : `${parsedRows.length} righe da importare`}
              </p>
              <div className="flex flex-wrap gap-3">
                {!importDone && (
                  <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={resetImport}
                      disabled={isImporting}
                      className="btn btn-ghost btn-sm"
                    >
                      Scegli altro file
                    </button>
                    <button
                      type="submit"
                      disabled={isImporting}
                      className="btn btn-primary btn-sm gap-2"
                    >
                      {isImporting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {importProgress
                            ? `${importProgress.done}/${importProgress.total}…`
                            : "Importazione…"}
                        </>
                      ) : (
                        <>
                          <FileSpreadsheet className="w-4 h-4" />
                          Conferma e importa tutte
                        </>
                      )}
                    </button>
                  </form>
                )}
                {importDone && (
                  <>
                    <button
                      type="button"
                      onClick={resetImport}
                      className="btn btn-ghost btn-sm"
                    >
                      Importa altro file
                    </button>
                    <Link to="/mediazioni" className="btn btn-primary btn-sm">
                      Vai alle Mediazioni
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
