import { useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { callRiconciliamoApi } from "~/lib/riconciliamo-api.server";
import { FileArchive, Loader2, UserCheck, UserPlus } from "lucide-react";

export const meta = () => [{ title: "Importa zip" }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);
  const soggetti = await pb
    .collection("soggetti")
    .getFullList({
      fields: "id,nome,cognome,codice_fiscale,ragione_sociale,tipo",
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
      tipo?: string;
    }>,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUserAndRole(request, "admin", "manager");
  if (!user?.id) throw redirect("/login");

  const formData = await request.formData();
  const file = formData.get("file");
  // Node 18 has no global File — treat Blob-like uploads by duck typing.
  const upload =
    file &&
    typeof file === "object" &&
    typeof (file as Blob).arrayBuffer === "function" &&
    typeof (file as { size?: number }).size === "number"
      ? (file as Blob & { name?: string; size: number })
      : null;
  if (!upload || upload.size === 0) {
    return json({ error: "File zip obbligatorio" }, 400);
  }

  const forward = new FormData();
  const filename = typeof upload.name === "string" && upload.name ? upload.name : "istanze.zip";
  forward.append("file", upload, filename);
  const res = await callRiconciliamoApi(request, "/api/riconciliamo/mediazioni/import-zip", {
    method: "POST",
    body: forward,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json(
      { error: (data as { message?: string }).message ?? "Import zip fallito" },
      res.status,
    );
  }
    const created = (data as { created?: number }).created ?? 0;
    const skipped = (data as { skipped?: number }).skipped ?? 0;
    const reusedIstante = (data as { reusedIstante?: number }).reusedIstante ?? 0;
    const reusedChiamato = (data as { reusedChiamato?: number }).reusedChiamato ?? 0;
    const errors = (data as { errors?: unknown[] }).errors ?? [];
    return json({
      success: created,
      skipped,
      errors,
      reusedIstante,
      reusedChiamato,
      message: `Import zip: ${created} create, ${skipped} già presenti (stesso codice univoco cliente). Istante già in DB: ${reusedIstante}. Chiamato già in DB: ${reusedChiamato}${errors.length ? `. ${errors.length} errori` : ""}.`,
    });
}

type PreviewRow = {
  index: number;
  codice: string;
  materia: string;
  chiamato: string;
  chiamatoCf: string;
  chiamatoNome: string;
  chiamatoCognome: string;
  istante: string;
};

type SoggettoLite = {
  id: string;
  nome?: string;
  cognome?: string;
  codice_fiscale?: string;
  ragione_sociale?: string;
  tipo?: string;
};

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function isInDb(
  soggetti: SoggettoLite[],
  opts: { full?: string; nome?: string; cognome?: string; cf?: string; giuridica?: boolean },
): boolean {
  const cf = (opts.cf || "").trim().toUpperCase().replace(/\s+/g, "");
  if (cf && cf.length >= 11 && !/^(N\.?D\.?|NA|\?+|X+)$/i.test(cf)) {
    if (soggetti.some((s) => (s.codice_fiscale || "").trim().toUpperCase().replace(/\s+/g, "") === cf)) {
      return true;
    }
  }
  const full = norm(opts.full || "");
  if (full && soggetti.some((s) => norm(s.ragione_sociale || "") === full)) return true;
  const nome = norm(opts.nome || "");
  const cognome = norm(opts.cognome || "");
  if (nome && cognome && soggetti.some((s) => norm(s.nome || "") === nome && norm(s.cognome || "") === cognome)) {
    return true;
  }
  if (full) {
    const parts = full.split(" ");
    if (parts.length >= 2) {
      const n = parts[0];
      const c = parts.slice(1).join(" ");
      if (soggetti.some((s) => norm(s.nome || "") === n && norm(s.cognome || "") === c)) return true;
    }
  }
  return false;
}

function DbBadge({ inDb }: { inDb: boolean }) {
  return inDb ? (
    <span className="badge badge-sm badge-success badge-outline gap-0.5">
      <UserCheck className="w-3 h-3" /> In rubrica
    </span>
  ) : (
    <span className="badge badge-sm badge-ghost gap-0.5">
      <UserPlus className="w-3 h-3" /> Nuovo
    </span>
  );
}

export default function ImportZipMediazioni() {
  const { soggetti } = useLoaderData<typeof loader>();
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [pendingZip, setPendingZip] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [pdfCount, setPdfCount] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const fetcher = useFetcher<typeof action>();

  const isImporting = fetcher.state === "submitting" || fetcher.state === "loading";
  const actionData = fetcher.data;

  const onZipSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError(null);
    setPreviewRows([]);
    try {
      const zip = await JSZip.loadAsync(file);
      let flussoEntry: JSZip.JSZipObject | undefined;
      let pdfs = 0;
      zip.forEach((relativePath, entry) => {
        if (entry.dir) return;
        const base = relativePath.split("/").pop() ?? relativePath;
        const lower = base.toLowerCase();
        if (lower === "flusso.xlsx" || (lower.endsWith(".xlsx") && lower.includes("flusso"))) {
          flussoEntry = entry;
        }
        if (lower.endsWith(".pdf")) pdfs += 1;
      });
      if (!flussoEntry) {
        setParseError("flusso.xlsx non trovato nello zip");
        setPendingZip(null);
        return;
      }
      const buf = await flussoEntry.async("arraybuffer");
      const workbook = XLSX.read(buf, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: "",
        raw: true,
      });
      const rows: PreviewRow[] = jsonRows.map((r, i) => ({
        index: i + 1,
        codice: String(
          r["codice univoco cliente"] ??
            r["Codice univoco cliente"] ??
            r["Codice Univoco Cliente"] ??
            "",
        ).trim(),
        materia: String(r["Materia"] ?? r["materia"] ?? "—"),
        istante: String(r["Nome e cognome Istante"] ?? "").trim() || "—",
        chiamatoNome: String(r["Nome Chiamato"] ?? "").trim(),
        chiamatoCognome: String(r["Cognome Chiamato"] ?? "").trim(),
        chiamato: [r["Nome Chiamato"], r["Cognome Chiamato"]].filter(Boolean).join(" ") || "—",
        chiamatoCf: String(r["CF Chiamato"] ?? "").trim(),
      }));
      setPreviewRows(rows);
      setPdfCount(pdfs);
      setPendingZip(file);
    } catch {
      setParseError("Zip non valido");
      setPendingZip(null);
    }
  };

  const handleSubmit = () => {
    if (!pendingZip) return;
    const fd = new FormData();
    fd.append("file", pendingZip, pendingZip.name);
    fetcher.submit(fd, {
      method: "post",
      action: "/mediazioni/import-zip",
      encType: "multipart/form-data",
    });
  };

  return (
    <div className="mx-auto max-w-5xl w-full space-y-5">
      <div>
        <Link to="/mediazioni?tab=da-assegnare" className="text-sm link link-hover text-base-content/70">
          ← Da assegnare
        </Link>
        <h1 className="text-2xl font-semibold text-base-content mt-2">Importa zip</h1>
        <p className="text-base-content/70 mt-1 text-sm max-w-2xl">
          Carica lo zip delle istanze (`flusso.xlsx` + PDF). Le mediazioni nascono in{" "}
          <strong>Da assegnare</strong>, senza RGM. Istante/chiamato già in rubrica vengono riutilizzati.
        </p>
      </div>

      <div className="rounded-lg border border-base-300 bg-base-100 p-4 flex flex-wrap items-center gap-3">
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={onZipSelected}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => zipInputRef.current?.click()}
          disabled={isImporting}
          className="btn btn-primary btn-sm gap-2"
        >
          <FileArchive className="w-4 h-4" />
          Carica zip
        </button>
        {pendingZip && (
          <span className="text-sm text-base-content/60">
            {pendingZip.name} · {previewRows.length} righe · {pdfCount} PDF
          </span>
        )}
      </div>

      {parseError && (
        <div className="alert alert-error mb-4">
          <span>{parseError}</span>
        </div>
      )}
      {actionData && "error" in actionData && (
        <div className="alert alert-error mb-4">
          <span>{String((actionData as { error?: string }).error)}</span>
        </div>
      )}
      {actionData && "message" in actionData && (
        <div className={`alert mb-4 ${(actionData as { errors?: unknown[] }).errors?.length ? "alert-warning" : "alert-success"}`}>
          <span>{(actionData as { message: string }).message}</span>
        </div>
      )}

      {previewRows.length > 0 && (
        <>
          <div className="rounded-lg border border-base-300 bg-base-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table table-sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Codice cliente</th>
                  <th>Istante</th>
                  <th>Chiamato</th>
                  <th>Materia</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r) => {
                  const istanteInDb = isInDb(soggetti, { full: r.istante, giuridica: true });
                  const chiamatoInDb = isInDb(soggetti, {
                    nome: r.chiamatoNome,
                    cognome: r.chiamatoCognome,
                    cf: r.chiamatoCf,
                  });
                  return (
                    <tr key={r.index}>
                      <td>{r.index}</td>
                      <td className="font-mono text-xs">{r.codice || "—"}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          {r.istante}
                          <DbBadge inDb={istanteInDb} />
                        </span>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          {r.chiamato}
                          <DbBadge inDb={chiamatoInDb} />
                        </span>
                      </td>
                      <td>{r.materia}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!(actionData && "success" in actionData) ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={isImporting}
                  onClick={() => {
                    setPendingZip(null);
                    setPreviewRows([]);
                  }}
                >
                  Scegli altro file
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm gap-2"
                  disabled={isImporting}
                  onClick={handleSubmit}
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Importazione…
                    </>
                  ) : (
                    "Conferma import"
                  )}
                </button>
              </>
            ) : (
              <Link to="/mediazioni?tab=da-assegnare" className="btn btn-primary btn-sm">
                Vai a Da assegnare
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
