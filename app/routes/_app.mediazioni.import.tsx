import { useState, useRef } from "react";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import * as XLSX from "xlsx";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { mapExcelRowsToImport, type ImportRow } from "~/lib/import-mediazioni-mapping";
import { importRows } from "~/lib/import-mediazioni.server";
import { Upload, FileSpreadsheet, Loader2, ExternalLink, UserCheck, UserPlus } from "lucide-react";

export const meta = () => [{ title: "Importa mediazioni" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);
  const soggetti = await pb
    .collection("soggetti")
    .getFullList({
      fields: "id,nome,cognome,codice_fiscale,indirizzo_riga_1,comune,provincia,cap",
      sort: "cognome,nome",
    })
    .catch(() => []);
  return json({
    soggetti: soggetti as Array<{
      id: string;
      nome?: string;
      cognome?: string;
      codice_fiscale?: string;
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

/** Formatta una data in italiano (g/m/aaaa). Accetta YYYY-MM-DD o formato US M/D/YY. */
function formatDateIT(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  const s = value.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${Number(d)}/${Number(m)}/${y}`;
  }
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const [, m, d, y] = us;
    const year = y!.length === 2 ? `20${y}` : y;
    return `${Number(d)}/${Number(m)}/${year}`;
  }
  return s;
}

type SoggettoMatch = { id: string; inDb: true } | { inDb: false };
function matchSoggetto(
  soggetti: Array<{ id: string; nome?: string; cognome?: string; codice_fiscale?: string }>,
  parte: { nome: string; cognome: string; codice_fiscale: string }
): SoggettoMatch {
  const cf = (parte.codice_fiscale || "").trim().toUpperCase();
  if (cf) {
    const byCf = soggetti.find(
      (s) => (s.codice_fiscale || "").trim().toUpperCase() === cf
    );
    if (byCf) return { id: byCf.id, inDb: true };
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
  const fetcher = useFetcher<typeof action>();

  const isImporting = fetcher.state === "submitting" || fetcher.state === "loading";
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
          raw: false,
        });
        const rows = mapExcelRowsToImport(jsonRows);
        setParsedRows(rows);
      } catch {
        setParsedRows([]);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedRows.length === 0) return;
    fetcher.submit(
      { rows: JSON.stringify(parsedRows) },
      { method: "post", action: "/mediazioni/import" }
    );
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
        Carica un file Excel nel formato Tracciato Organismo. Il file verrà analizzato e potrai
        verificare le righe prima di importarle nel database.
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
          disabled={isImporting}
          className="btn btn-primary gap-2"
        >
          <Upload className="w-4 h-4" />
          Carica file Excel
        </button>
        {parsedRows.length > 0 && (
          <span className="ml-3 text-sm text-slate-500">
            {parsedRows.length} righe pronte per l&apos;anteprima
          </span>
        )}
      </div>

      {parsedRows.length > 0 && (
        <>
          <p className="text-sm text-slate-600 mb-2">
            Controlla i dati qui sotto. Istante/Chiamato in DB verranno riutilizzati (campi vuoti aggiornati dall’Excel).
            Link Istanza e Cartella → documenti. Data e ora incontro → record in Incontri.
          </p>
          <div className="overflow-x-auto border border-slate-200 rounded-lg mb-6">
            <table className="table table-zebra table-pin-rows min-w-[900px]">
              <thead>
                <tr>
                  <th>#</th>
                  <th>RGM</th>
                  <th>Mediatore</th>
                  <th>Istante</th>
                  <th>Chiamato</th>
                  <th>Link Istanza</th>
                  <th>Link Cartella</th>
                  <th>Incontro (data · ora)</th>
                  <th>Oggetto / Materia</th>
                  <th>Valore</th>
                  <th>Competenza</th>
                  <th>Data deposito</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row) => {
                  const istanteMatch = matchSoggetto(soggetti, row.parteIstante);
                  const chiamatoMatch = matchSoggetto(soggetti, row.parteChiamato);
                  const linkIstanza = (row.mediazionePayload.link_istanza || "").trim();
                  const linkCartella = (row.mediazionePayload.link_cartella || "").trim();
                  const isUrl = (s: string) =>
                    s.startsWith("http://") || s.startsWith("https://");
                  return (
                    <tr key={row.index}>
                      <td>{row.index}</td>
                      <td className="font-medium">{row.mediazionePayload.rgm || "—"}</td>
                      <td>{row.mediazionePayload.mediatore || "—"}</td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span>{getIstanteLabel(row) || "—"}</span>
                          {istanteMatch.inDb ? (
                            <span className="badge badge-sm badge-info shrink-0 gap-0.5" title="Già in rubrica">
                              <UserCheck className="w-3 h-3" /> In DB
                            </span>
                          ) : (
                            <span className="badge badge-sm badge-ghost shrink-0 gap-0.5" title="Nuovo soggetto">
                              <UserPlus className="w-3 h-3" /> Nuovo
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span>{getChiamatoLabel(row) || "—"}</span>
                          {chiamatoMatch.inDb ? (
                            <span className="badge badge-sm badge-info shrink-0 gap-0.5" title="Già in rubrica">
                              <UserCheck className="w-3 h-3" /> In DB
                            </span>
                          ) : (
                            <span className="badge badge-sm badge-ghost shrink-0 gap-0.5" title="Nuovo soggetto">
                              <UserPlus className="w-3 h-3" /> Nuovo
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        {linkIstanza && isUrl(linkIstanza) ? (
                          <a
                            href={linkIstanza}
                            target="_blank"
                            rel="noreferrer"
                            className="link link-primary text-xs inline-flex items-center gap-0.5"
                          >
                            Apri <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          linkIstanza ? <span className="text-slate-500 text-xs break-all">{linkIstanza.length > 40 ? `${linkIstanza.slice(0, 40)}…` : linkIstanza}</span> : "—"
                        )}
                      </td>
                      <td>
                        {linkCartella && isUrl(linkCartella) ? (
                          <a
                            href={linkCartella}
                            target="_blank"
                            rel="noreferrer"
                            className="link link-primary text-xs inline-flex items-center gap-0.5"
                          >
                            Apri <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          linkCartella ? <span className="text-slate-500 text-xs break-all">{linkCartella.length > 40 ? `${linkCartella.slice(0, 40)}…` : linkCartella}</span> : "—"
                        )}
                      </td>
                      <td>
                        {row.mediazionePayload.data_incontro && row.mediazionePayload.ora_incontro ? (
                          <span className="text-sm">{formatDateIT(row.mediazionePayload.data_incontro)} · {row.mediazionePayload.ora_incontro}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{row.mediazionePayload.oggetto || "—"}</td>
                      <td>{row.mediazionePayload.valore || "—"}</td>
                      <td>{row.mediazionePayload.competenza || "—"}</td>
                      <td>{formatDateIT(row.mediazionePayload.data_protocollo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {parsedRows.length > 0 && !(actionData && "success" in actionData) && (
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isImporting}
            className="btn btn-primary gap-2"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importazione in corso...
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4" />
                Conferma e importa tutte
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setParsedRows([]);
            }}
            disabled={isImporting}
            className="btn btn-ghost"
          >
            Scegli altro file
          </button>
        </form>
      )}

      {actionData && "message" in actionData && (
        <div
          className={`alert mb-6 ${
            (actionData as { errors?: unknown[] }).errors?.length
              ? "alert-warning"
              : "alert-success"
          }`}
        >
          <span>{(actionData as { message: string }).message}</span>
        </div>
      )}

      {actionData && "success" in actionData && (
        <div className="flex flex-wrap gap-3 mt-6">
          <Link to="/mediazioni" className="btn btn-primary">
            Vai alle Mediazioni
          </Link>
          <button
            type="button"
            onClick={() => {
              setParsedRows([]);
            }}
            className="btn btn-ghost"
          >
            Importa altro file
          </button>
        </div>
      )}
    </div>
  );
}
