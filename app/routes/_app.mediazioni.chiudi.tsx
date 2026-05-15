import { useRef, useState } from "react";
import { Link, useFetcher } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { createPB } from "~/lib/pocketbase.server";
import { requireUserAndRole } from "~/lib/auth.server";
import { normalizeEsitoFinale } from "~/lib/esito-finale";

type CloseRow = {
  index: number;
  rgm: string;
  esito_finale: string;
  data_chiusura: string;
  nota: string;
};

type RowValidationIssue = {
  index: number;
  rgm: string;
  error: string;
  /** true when one or both fields are missing but the row is otherwise valid */
  completable?: boolean;
  missingFields?: ("esito_finale" | "data_chiusura")[];
  mediazioneId?: string;
};

type ValidatedRow = CloseRow & {
  mediazioneId: string;
};

export const meta = () => [{ title: "Chiudi mediazioni da Excel" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  return json({});
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseExcelDate(value: unknown): string {
  if (typeof value === "number") {
    const millis = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(millis);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!match) return raw;
  const dd = String(Number(match[1])).padStart(2, "0");
  const mm = String(Number(match[2])).padStart(2, "0");
  const yyyy = match[3];
  return `${yyyy}-${mm}-${dd}`;
}

function mapExcelRowsToClose(jsonRows: Record<string, unknown>[]): CloseRow[] {
  return jsonRows
    .map((row, index) => {
      const entries = Object.entries(row);
      const values: Record<string, unknown> = {};
      for (const [key, value] of entries) values[normalizeHeader(key)] = value;
      return {
        index: index + 1,
        rgm: String(values.rgm ?? "").trim(),
        esito_finale: normalizeEsitoFinale(
          String(values.esito_finale ?? values.esito ?? "")
        ),
        data_chiusura: parseExcelDate(values.data_chiusura),
        nota: String(values.nota ?? "").trim(),
      };
    })
    .filter((r) => r.rgm || r.esito_finale || r.data_chiusura || r.nota);
}

function isAlreadyClosed(row: { esito_finale?: unknown; data_chiusura?: unknown }) {
  const dataChiusura = row.data_chiusura ? String(row.data_chiusura).trim() : "";
  const esito = row.esito_finale ? String(row.esito_finale).trim().toLowerCase() : "";
  return Boolean(dataChiusura) && Boolean(esito) && esito !== "in corso";
}

async function validateRows(
  pb: Awaited<ReturnType<typeof createPB>>["pb"],
  rows: CloseRow[]
): Promise<{ validRows: ValidatedRow[]; issues: RowValidationIssue[] }> {
  const issues: RowValidationIssue[] = [];
  const validRows: ValidatedRow[] = [];
  const seenRgm = new Set<string>();

  for (let row of rows) {
    if (!row.rgm) {
      issues.push({ index: row.index, rgm: "", error: "RGM mancante" });
      continue;
    }

    const rgmKey = row.rgm.toLowerCase();
    if (seenRgm.has(rgmKey)) {
      issues.push({ index: row.index, rgm: row.rgm, error: "RGM duplicato nel file" });
      continue;
    }
    seenRgm.add(rgmKey);

    const found = await pb
      .collection("mediazioni")
      .getFullList({
        filter: pb.filter("rgm = {:rgm}", { rgm: row.rgm }),
        fields: "id,rgm,esito_finale,data_chiusura",
        limit: 2,
      })
      .catch(() => []);

    if (found.length === 0) {
      issues.push({ index: row.index, rgm: row.rgm, error: "RGM non trovato" });
      continue;
    }
    if (found.length > 1) {
      issues.push({ index: row.index, rgm: row.rgm, error: "RGM non univoco in archivio" });
      continue;
    }
    if (isAlreadyClosed(found[0] as { esito_finale?: unknown; data_chiusura?: unknown })) {
      issues.push({ index: row.index, rgm: row.rgm, error: "Mediazione già chiusa" });
      continue;
    }

    const mediazioneId = String((found[0] as { id: string }).id);
    const dbEsito = String((found[0] as { esito_finale?: unknown }).esito_finale ?? "").trim();

    if (!row.esito_finale && dbEsito) {
      row = { ...row, esito_finale: dbEsito };
    }

    if (!row.esito_finale) {
      issues.push({
        index: row.index,
        rgm: row.rgm,
        error: row.data_chiusura ? "Esito finale mancante" : "Esito finale e data chiusura mancanti",
        mediazioneId,
      });
      continue;
    }

    if (!row.data_chiusura) {
      issues.push({
        index: row.index,
        rgm: row.rgm,
        error: "Data chiusura mancante o non valida",
        completable: true,
        missingFields: ["data_chiusura"],
        mediazioneId,
      });
      continue;
    }

    validRows.push({ ...row, mediazioneId });
  }

  return { validRows, issues };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);
  if (!user?.id) throw redirect("/login");

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const formData = await request.formData();
  const actionType = String(formData.get("_action") ?? "");
  const rowsRaw = formData.get("rows");
  let rows: CloseRow[] = [];

  try {
    rows = typeof rowsRaw === "string" ? (JSON.parse(rowsRaw) as CloseRow[]) : [];
  } catch {
    return json({ error: "Dati non validi" }, 400);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: "Nessuna riga da elaborare" }, 400);
  }

  const { validRows, issues } = await validateRows(pb, rows);

  if (actionType === "validate") {
    return json({
      step: "validate" as const,
      validRows,
      issues,
      canClose: validRows.length > 0 || issues.some((i) => i.completable),
      message:
        issues.length > 0 && validRows.length > 0
          ? `Validazione completata: ${validRows.length} righe valide, ${issues.length} con problemi.`
          : issues.length > 0
          ? `Validazione completata: tutte le ${issues.length} righe hanno problemi.`
          : `Validazione OK: ${validRows.length} mediazioni pronte per la chiusura.`,
    });
  }

  if (actionType !== "close") {
    return json({ error: "Azione non valida" }, 400);
  }

  let success = 0;
  const errors: { index: number; rgm: string; error: string }[] = [];
  for (const row of validRows) {
    try {
      const current = await pb.collection("mediazioni").getOne(row.mediazioneId, { fields: "nota" });
      const currentNota = current.nota ? String(current.nota).trim() : "";
      const noteToAppend = row.nota.trim();
      const nextNota = noteToAppend
        ? currentNota
          ? `${currentNota}\n${noteToAppend}`
          : noteToAppend
        : currentNota;

      await pb.collection("mediazioni").update(row.mediazioneId, {
        esito_finale: row.esito_finale,
        data_chiusura: row.data_chiusura,
        nota: nextNota || undefined,
      });
      success++;
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Errore sconosciuto";
      errors.push({ index: row.index, rgm: row.rgm, error: msg });
    }
  }

  const allErrors = [
    ...issues.map((i) => ({ index: i.index, rgm: i.rgm, error: i.error })),
    ...errors,
  ];

  return json({
    step: "close" as const,
    success,
    errors: allErrors,
    message:
      success > 0
        ? `Chiusura completata: ${success} mediazioni aggiornate${allErrors.length ? `, ${allErrors.length} saltate con problemi` : ""}.`
        : `Nessuna mediazione chiusa: tutte le ${allErrors.length} righe hanno problemi.`,
  });
}

function downloadIssuesAsExcel(
  issues: { index: number; rgm: string; error: string }[],
  parsedRows: CloseRow[]
) {
  const rowMap = new Map(parsedRows.map((r) => [r.index, r]));
  const data = issues.map((issue) => {
    const original = rowMap.get(issue.index);
    return {
      Riga: issue.index,
      RGM: issue.rgm || original?.rgm || "",
      Esito_finale: original?.esito_finale || "",
      Data_chiusura: original?.data_chiusura || "",
      Nota: original?.nota || "",
      Problema: issue.error,
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Problemi");
  XLSX.writeFile(wb, "mediazioni_con_problemi.xlsx");
}

export default function ChiudiMediazioniFromExcel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher<typeof action>();
  const [parsedRows, setParsedRows] = useState<CloseRow[]>([]);
  const isSubmitting = fetcher.state === "submitting" || fetcher.state === "loading";
  const actionData = fetcher.data;

  const updateRowField = (index: number, field: "esito_finale" | "data_chiusura", value: string) => {
    setParsedRows((prev) =>
      prev.map((r) => (r.index === index ? { ...r, [field]: value } : r))
    );
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isExcel =
      file.name.endsWith(".xlsx") ||
      file.name.endsWith(".xls") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";

    if (!isExcel) {
      setParsedRows([]);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        if (!data) return;
        const workbook = XLSX.read(data, { type: "binary" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
          defval: "",
          raw: true,
        });
        setParsedRows(mapExcelRowsToClose(jsonRows));
      } catch {
        setParsedRows([]);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const submitValidate = () => {
    if (parsedRows.length === 0) return;
    fetcher.submit(
      { _action: "validate", rows: JSON.stringify(parsedRows) },
      { method: "post", action: "/mediazioni/chiudi" }
    );
  };

  const submitClose = () => {
    if (parsedRows.length === 0) return;
    fetcher.submit(
      { _action: "close", rows: JSON.stringify(parsedRows) },
      { method: "post", action: "/mediazioni/chiudi" }
    );
  };

  const validationIssues =
    actionData && "issues" in actionData && Array.isArray(actionData.issues)
      ? (actionData.issues as RowValidationIssue[])
      : [];
  const completableIssues = validationIssues.filter((i) => i.completable);
  const fatalIssues = validationIssues.filter((i) => !i.completable);
  const canClose = Boolean(actionData && "canClose" in actionData && actionData.canClose);
  const closeErrors =
    actionData && "errors" in actionData && Array.isArray(actionData.errors)
      ? actionData.errors
      : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-2">
      <div className="mb-2">
        <Link
          to="/mediazioni"
          className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
        >
          ← Elenco mediazioni
        </Link>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Carica un file Excel con le colonne <strong>rgm</strong>, <strong>esito</strong> (o{" "}
        <strong>esito_finale</strong>), <strong>data_chiusura</strong>, <strong>nota</strong>. Prima
        viene eseguita una validazione completa; le righe con problemi vengono saltate e puoi
        scaricarle come Excel separato per correggerle e ricaricarle.
      </p>

      <div className="mb-2">
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
          disabled={isSubmitting}
          className="btn btn-primary gap-2"
        >
          <Upload className="w-4 h-4" />
          Carica file Excel
        </button>
        {parsedRows.length > 0 && (
          <span className="ml-3 text-sm text-slate-500">
            {parsedRows.length} righe pronte per la validazione
          </span>
        )}
      </div>

      {actionData && "message" in actionData && (
        <div
          className={`alert mb-4 ${
            "errors" in actionData &&
            Array.isArray(actionData.errors) &&
            actionData.errors.length > 0
              ? "alert-warning"
              : "alert-success"
          }`}
        >
          <span>{actionData.message}</span>
        </div>
      )}

      {/* Two-column layout: parsed rows on the left, issues on the right */}
      {parsedRows.length > 0 && (
        <div
          className={`mb-4 gap-4 ${
            completableIssues.length > 0 || fatalIssues.length > 0 || closeErrors.length > 0
              ? "grid grid-cols-2"
              : ""
          }`}
        >
          {/* Left: parsed rows preview */}
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-medium text-slate-500 mb-1">
              {parsedRows.length} righe caricate
            </p>
            <div className="overflow-auto max-h-[52vh] border border-slate-200 rounded-lg">
              <table className="table table-zebra table-pin-rows table-sm">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>RGM</th>
                    <th>Esito finale</th>
                    <th>Data chiusura</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row) => (
                    <tr key={`${row.index}-${row.rgm}`}>
                      <td>{row.index}</td>
                      <td>{row.rgm || "—"}</td>
                      <td>{row.esito_finale || "—"}</td>
                      <td>{row.data_chiusura || "—"}</td>
                      <td>{row.nota || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: completable + fatal + close errors — each section is its own scroll container */}
          {(completableIssues.length > 0 || fatalIssues.length > 0 || (closeErrors.length > 0 && actionData && "step" in actionData && actionData.step === "close")) && (
            <div className="flex flex-col gap-2 max-h-[52vh] overflow-hidden">

              {completableIssues.length > 0 && (
                <div className="flex flex-col min-h-0 flex-1">
                  <p className="shrink-0 text-xs font-medium text-amber-700 py-1 border-b border-amber-100">
                    {completableIssues.length}{" "}
                    {completableIssues.length === 1 ? "riga" : "righe"} con campo mancante — compila per includerle
                  </p>
                  <div className="overflow-auto min-h-0 flex-1 border border-amber-300 rounded-lg mt-1">
                    <table className="table table-sm min-w-full">
                      <thead className="sticky top-0 z-10 bg-white">
                        <tr>
                          <th>Riga</th>
                          <th>RGM</th>
                          <th>Esito finale</th>
                          <th>Data chiusura</th>
                        </tr>
                      </thead>
                      <tbody>
                        {completableIssues.map((issue) => {
                          const row = parsedRows.find((r) => r.index === issue.index);
                          return (
                            <tr key={`completable-${issue.index}`}>
                              <td>{issue.index}</td>
                              <td>{issue.rgm}</td>
                              <td>{row?.esito_finale || "—"}</td>
                              <td>
                                <input
                                  type="date"
                                  value={row?.data_chiusura ?? ""}
                                  onChange={(e) =>
                                    updateRowField(issue.index, "data_chiusura", e.target.value)
                                  }
                                  className="input input-sm input-bordered w-full max-w-[150px]"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {fatalIssues.length > 0 && (
                <div className="flex flex-col min-h-0 flex-1">
                  <div className="shrink-0 flex items-center justify-between py-1 border-b border-warning/20">
                    <p className="text-xs font-medium text-warning">
                      {fatalIssues.length}{" "}
                      {fatalIssues.length === 1 ? "riga con problema" : "righe con problemi"} — verranno saltate
                    </p>
                    <button
                      type="button"
                      onClick={() => downloadIssuesAsExcel(fatalIssues, parsedRows)}
                      className="btn btn-xs btn-ghost gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Scarica
                    </button>
                  </div>
                  <div className="overflow-auto min-h-0 flex-1 border border-warning/40 rounded-lg mt-1">
                    <table className="table table-sm min-w-full">
                      <thead className="sticky top-0 z-10 bg-white">
                        <tr>
                          <th>Riga</th>
                          <th>RGM</th>
                          <th>Problema</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fatalIssues.map((issue) => (
                          <tr key={`${issue.index}-${issue.rgm}-${issue.error}`}>
                            <td>{issue.index}</td>
                            <td>{issue.rgm || "—"}</td>
                            <td>{issue.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {closeErrors.length > 0 && actionData && "step" in actionData && actionData.step === "close" && (
                <div className="flex flex-col min-h-0 flex-1">
                  <div className="shrink-0 flex items-center justify-between py-1 border-b border-warning/20">
                    <p className="text-xs font-medium text-warning">
                      {closeErrors.length}{" "}
                      {closeErrors.length === 1 ? "riga saltata" : "righe saltate"} durante la chiusura
                    </p>
                    <button
                      type="button"
                      onClick={() => downloadIssuesAsExcel(closeErrors, parsedRows)}
                      className="btn btn-xs btn-ghost gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Scarica
                    </button>
                  </div>
                  <div className="overflow-auto min-h-0 flex-1 border border-warning/40 rounded-lg mt-1">
                    <table className="table table-sm min-w-full">
                      <thead className="sticky top-0 z-10 bg-white">
                        <tr>
                          <th>Riga</th>
                          <th>RGM</th>
                          <th>Problema</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closeErrors.map((err) => (
                          <tr key={`${err.index}-${err.rgm}-${err.error}`}>
                            <td>{err.index}</td>
                            <td>{err.rgm || "—"}</td>
                            <td>{err.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      )}

      {parsedRows.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={submitValidate}
            disabled={isSubmitting}
            className="btn btn-primary gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Elaborazione...
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4" />
                Valida file
              </>
            )}
          </button>

          {canClose && (
            <button
              type="button"
              onClick={submitClose}
              disabled={isSubmitting}
              className="btn btn-warning"
              title={
                completableIssues.length > 0
                  ? "Le righe con campo completato saranno incluse; quelle ancora vuote verranno saltate"
                  : undefined
              }
            >
              Conferma chiusura mediazioni
            </button>
          )}

          <button
            type="button"
            onClick={() => setParsedRows([])}
            disabled={isSubmitting}
            className="btn btn-ghost"
          >
            Scegli altro file
          </button>
        </div>
      )}
    </div>
  );
}
