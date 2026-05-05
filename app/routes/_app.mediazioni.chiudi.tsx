import { useRef, useState } from "react";
import { Link, useFetcher } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { createPB } from "~/lib/pocketbase.server";
import { requireUserAndRole } from "~/lib/auth.server";

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
        esito_finale: String(values.esito_finale ?? "").trim(),
        data_chiusura: parseExcelDate(values.data_chiusura),
        nota: String(values.nota ?? "").trim(),
      };
    })
    .filter((r) => r.rgm || r.esito_finale || r.data_chiusura || r.nota);
}

function isAlreadyClosed(row: { esito_finale?: unknown; data_chiusura?: unknown }) {
  const dataChiusura = row.data_chiusura ? String(row.data_chiusura).trim() : "";
  const esito = row.esito_finale ? String(row.esito_finale).trim().toLowerCase() : "";
  return Boolean(dataChiusura) || (Boolean(esito) && esito !== "in corso");
}

async function validateRows(
  pb: Awaited<ReturnType<typeof createPB>>["pb"],
  rows: CloseRow[]
): Promise<{ validRows: ValidatedRow[]; issues: RowValidationIssue[] }> {
  const issues: RowValidationIssue[] = [];
  const validRows: ValidatedRow[] = [];
  const seenRgm = new Set<string>();

  for (const row of rows) {
    if (!row.rgm) {
      issues.push({ index: row.index, rgm: "", error: "RGM mancante" });
      continue;
    }
    if (!row.esito_finale) {
      issues.push({ index: row.index, rgm: row.rgm, error: "Esito finale mancante" });
      continue;
    }
    if (!row.data_chiusura) {
      issues.push({ index: row.index, rgm: row.rgm, error: "Data chiusura mancante o non valida" });
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
      issues.push({ index: row.index, rgm: row.rgm, error: "Mediazione gia chiusa" });
      continue;
    }

    validRows.push({
      ...row,
      mediazioneId: String((found[0] as { id: string }).id),
    });
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
      canClose: issues.length === 0 && validRows.length > 0,
      message:
        issues.length > 0
          ? `Validazione completata con ${issues.length} problemi.`
          : `Validazione OK: ${validRows.length} mediazioni pronte per la chiusura.`,
    });
  }

  if (actionType !== "close") {
    return json({ error: "Azione non valida" }, 400);
  }

  if (issues.length > 0) {
    return json(
      {
        step: "close" as const,
        success: 0,
        errors: issues.map((i) => ({ index: i.index, rgm: i.rgm, error: i.error })),
        message: "Impossibile chiudere: la validazione ha trovato problemi.",
      },
      { status: 400 }
    );
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

  return json({
    step: "close" as const,
    success,
    errors,
    message: `Chiusura completata: ${success} mediazioni aggiornate${errors.length ? `, ${errors.length} errori` : ""}.`,
  });
}

export default function ChiudiMediazioniFromExcel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher<typeof action>();
  const [parsedRows, setParsedRows] = useState<CloseRow[]>([]);
  const isSubmitting = fetcher.state === "submitting" || fetcher.state === "loading";
  const actionData = fetcher.data;

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
      ? actionData.issues
      : [];
  const canClose = Boolean(actionData && "canClose" in actionData && actionData.canClose);
  const closeErrors =
    actionData && "errors" in actionData && Array.isArray(actionData.errors)
      ? actionData.errors
      : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6">
        <Link
          to="/mediazioni"
          className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
        >
          ← Elenco mediazioni
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-slate-800 mb-2">Chiudi mediazioni da Excel</h1>
      <p className="text-slate-600 mb-6">
        Carica un file Excel con le colonne <strong>rgm</strong>, <strong>esito_finale</strong>,{" "}
        <strong>data_chiusura</strong>, <strong>nota</strong>. Prima viene eseguita una validazione
        completa; se non ci sono problemi, puoi confermare la chiusura massiva.
      </p>

      <div className="mb-6">
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

      {parsedRows.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-lg mb-6">
          <table className="table table-zebra table-pin-rows">
            <thead>
              <tr>
                <th>#</th>
                <th>RGM</th>
                <th>Esito finale</th>
                <th>Data chiusura</th>
                <th>Nota da aggiungere</th>
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
      )}

      {actionData && "message" in actionData && (
        <div
          className={`alert mb-6 ${
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

      {validationIssues.length > 0 && (
        <div className="overflow-x-auto border border-warning/40 rounded-lg mb-6">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Riga</th>
                <th>RGM</th>
                <th>Problema</th>
              </tr>
            </thead>
            <tbody>
              {validationIssues.map((issue) => (
                <tr key={`${issue.index}-${issue.rgm}-${issue.error}`}>
                  <td>{issue.index}</td>
                  <td>{issue.rgm || "—"}</td>
                  <td>{issue.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {closeErrors.length > 0 && actionData && "step" in actionData && actionData.step === "close" && (
        <div className="overflow-x-auto border border-warning/40 rounded-lg mb-6">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Riga</th>
                <th>RGM</th>
                <th>Errore</th>
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
      )}

      {parsedRows.length > 0 && (
        <div className="flex flex-wrap gap-3">
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
