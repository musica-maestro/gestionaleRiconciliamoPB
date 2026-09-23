import { useEffect, useRef, useState } from "react";
import { Form, Link, useActionData, useNavigation, useSubmit } from "@remix-run/react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";
import { ArrowLeft, CheckCircle, FileText, Upload } from "lucide-react";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { isUploadedFile } from "~/lib/form-data.server";
import {
  collectPdfsFromUploads,
  importConvocazioniFromAlfared,
  indexPdfsByMediazioneId,
  processAlfaredFiles,
  type AlfaredProcessResult,
} from "~/lib/convocazioni-import.server";

export const meta: MetaFunction = () => [{ title: "Carica convocazioni (Flusso)" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  // Come Esporta Flusso: qualsiasi ruolo autenticato può ricaricare il ritorno
  if (role !== "admin" && role !== "manager" && role !== "mediatore") {
    throw new Response("Non autorizzato", { status: 403 });
  }
  return json({ ok: true });
}

type ActionData = {
  error?: string;
  processResult?: AlfaredProcessResult;
  pdfCount?: number;
  success?: {
    convocazioniCreated: number;
    convocazioniSkipped: number;
    pecCreated: number;
    documentiCreated: number;
    errors: string[];
  };
};

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  if (role !== "admin" && role !== "manager" && role !== "mediatore") {
    return json({ error: "Non autorizzato" } satisfies ActionData, { status: 403 });
  }

  const { pb } = await createPB(request);
  const formData = await request.formData();
  const mode = String(formData.get("mode") ?? "");

  try {
    const csvFiles = formData.getAll("csv").filter(isUploadedFile);
    const pdfZipFiles = formData.getAll("pdfs").filter(isUploadedFile);

    if (mode === "preview" || mode === "import") {
      if (csvFiles.length === 0) {
        return json(
          { error: "CSV Alfared obbligatorio" } satisfies ActionData,
          { status: 400 },
        );
      }
      if (pdfZipFiles.length === 0) {
        return json(
          {
            error: "ZIP/PDF contenuto obbligatorio (stesso pacchetto del Flusso inviato)",
          } satisfies ActionData,
          { status: 400 },
        );
      }
      for (const f of csvFiles) {
        if (!f.name.toLowerCase().endsWith(".csv")) {
          return json(
            { error: `"${f.name}" non è un CSV` } satisfies ActionData,
            { status: 400 },
          );
        }
      }
    }

    if (mode === "preview") {
      const processResult = await processAlfaredFiles(csvFiles);
      const pdfs = await collectPdfsFromUploads(pdfZipFiles);
      const pdfById = indexPdfsByMediazioneId(pdfs);

      if (!processResult.validRows.length && processResult.invalidRows.length > 0) {
        return json(
          { error: "Nessuna riga valida nel CSV", processResult, pdfCount: pdfById.size } satisfies ActionData,
          { status: 400 },
        );
      }

      // Mark rows without matching PDF as invalid for selection UX
      const withPdfCheck = processResult.validRows.map((row) => {
        if (row.mediazioneId && !pdfById.has(row.mediazioneId)) {
          return {
            ...row,
            _missingPdf: true as const,
          };
        }
        return row;
      });
      // Move missing-PDF into invalid for clarity in preview
      const validRows = withPdfCheck.filter((r) => !("_missingPdf" in r && r._missingPdf));
      const missingPdfRows = withPdfCheck
        .filter((r): r is typeof r & { _missingPdf: true } => Boolean((r as { _missingPdf?: boolean })._missingPdf))
        .map((r, i) => ({
          rowIndex: 10_000 + i,
          data: {
            id_lesive: r.mediazioneId ?? "",
            numero: r.numero ?? "",
          },
          error: `Manca PDF ${r.mediazioneId}.pdf nello ZIP`,
        }));

      processResult.validRows = validRows;
      processResult.invalidRows = [...processResult.invalidRows, ...missingPdfRows];

      const numeri = Array.from(
        new Set(processResult.validRows.map((r) => r.numero).filter((n): n is string => Boolean(n))),
      );
      const existing = new Set<string>();
      for (const numero of numeri) {
        try {
          const escaped = numero.replace(/"/g, '\\"');
          await pb
            .collection("convocazioni")
            .getFirstListItem(
              `numero_raccomandata = "${escaped}" && tipologia = "Raccomandata"`,
            );
          existing.add(numero);
        } catch {
          // not found
        }
      }
      processResult.existingNumeri = Array.from(existing);
      return json({ processResult, pdfCount: pdfById.size } satisfies ActionData);
    }

    if (mode === "import") {
      const indicesRaw = String(formData.get("validRowIndices") ?? "[]");
      let validRowIndices: number[] = [];
      try {
        validRowIndices = JSON.parse(indicesRaw) as number[];
      } catch {
        return json({ error: "Selezione righe non valida" } satisfies ActionData, { status: 400 });
      }
      if (validRowIndices.length === 0) {
        return json(
          { error: "Seleziona almeno una riga da importare" } satisfies ActionData,
          { status: 400 },
        );
      }

      const processResult = await processAlfaredFiles(csvFiles);
      const pdfs = await collectPdfsFromUploads(pdfZipFiles);
      const pdfByMediazioneId = indexPdfsByMediazioneId(pdfs);
      const rows = processResult.validRows.filter((_, i) => validRowIndices.includes(i));

      const result = await importConvocazioniFromAlfared(pb, rows, {
        createPecIstante: true,
        pdfByMediazioneId,
      });

      return json({
        success: {
          convocazioniCreated: result.created,
          convocazioniSkipped: result.skipped,
          pecCreated: result.pecCreated,
          documentiCreated: result.documentiCreated,
          errors: result.errors,
        },
      } satisfies ActionData);
    }

    return json({ error: "Modalità non valida" } satisfies ActionData, { status: 400 });
  } catch (e) {
    console.error("convocazioni upload error", e);
    return json(
      {
        error: e instanceof Error ? e.message : "Errore durante il caricamento",
      } satisfies ActionData,
      { status: 500 },
    );
  }
}

export default function ConvocazioniUpload() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";

  const [csvNames, setCsvNames] = useState<string[]>([]);
  const [pdfNames, setPdfNames] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const csvFilesRef = useRef<File[]>([]);
  const pdfFilesRef = useRef<File[]>([]);

  const processResult = actionData?.processResult;
  const validRows = processResult?.validRows ?? [];
  const invalidRows = processResult?.invalidRows ?? [];
  const existingSet = new Set(processResult?.existingNumeri ?? []);
  const addable = validRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.numero || !existingSet.has(row.numero));

  useEffect(() => {
    if (!processResult) return;
    setSelectedRows(
      processResult.validRows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !row.numero || !existingSet.has(row.numero))
        .map(({ index }) => index),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processResult]);

  function handleImport() {
    if (selectedRows.length === 0) return;
    if (csvFilesRef.current.length === 0 || pdfFilesRef.current.length === 0) {
      alert("File persi dalla sessione — ricomincia e seleziona di nuovo CSV + ZIP.");
      return;
    }
    const fd = new FormData();
    fd.set("mode", "import");
    fd.set("validRowIndices", JSON.stringify(selectedRows));
    for (const f of csvFilesRef.current) fd.append("csv", f);
    for (const f of pdfFilesRef.current) fd.append("pdfs", f);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-base-content flex items-center gap-2">
            <Upload className="h-6 w-6 text-primary" />
            Carica ritorno Flusso
          </h1>
          <p className="text-sm text-base-content/60 mt-0.5">
            Servono <strong>entrambi</strong>: CSV Alfared + ZIP/PDF. Ogni raccomandata va sulla
            convocazione del <strong>chiamato</strong>; il PDF finisce in{" "}
            <strong>Documenti</strong> (tipo Contenuto raccomandata) con descrizione; la PEC
            sull&apos;<strong>istante</strong>.
          </p>
        </div>
        <Link to="/mediazioni?tab=da-convocare" className="btn btn-ghost btn-sm gap-1">
          <ArrowLeft className="h-4 w-4" />
          Da convocare
        </Link>
      </div>

      {actionData?.error && (
        <div className="alert alert-error py-2 text-sm">{actionData.error}</div>
      )}

      {actionData?.success && (
        <div className="alert alert-success py-3 text-sm">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <div>
            <p>
              Raccomandate (chiamato):{" "}
              <strong>{actionData.success.convocazioniCreated}</strong>
              {actionData.success.convocazioniSkipped > 0
                ? ` · saltate ${actionData.success.convocazioniSkipped}`
                : ""}
              {actionData.success.documentiCreated > 0
                ? ` · documenti: ${actionData.success.documentiCreated}`
                : ""}
              {actionData.success.pecCreated > 0
                ? ` · PEC istante: ${actionData.success.pecCreated}`
                : ""}
            </p>
            {actionData.success.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-xs opacity-90 max-h-32 overflow-y-auto">
                {actionData.success.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <Link to="/mediazioni?tab=aperte" className="link link-hover text-sm mt-2 inline-block">
              Vai alle mediazioni aperte →
            </Link>
          </div>
        </div>
      )}

      {!processResult && !actionData?.success && (
        <Form
          method="post"
          encType="multipart/form-data"
          className="card bg-base-100 border border-base-300 shadow-sm"
        >
          <div className="card-body gap-4">
            <input type="hidden" name="mode" value="preview" />
            <label className="form-control w-full">
              <span className="label-text font-medium mb-1">1. CSV Alfared (tracciamento) *</span>
              <input
                type="file"
                name="csv"
                accept=".csv,text/csv"
                multiple
                className="file-input file-input-bordered file-input-sm w-full"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  csvFilesRef.current = files;
                  setCsvNames(files.map((f) => f.name));
                }}
                required
              />
              {csvNames.length > 0 && (
                <span className="label-text-alt mt-1">{csvNames.join(", ")}</span>
              )}
            </label>
            <label className="form-control w-full">
              <span className="label-text font-medium mb-1 flex items-center gap-1">
                <FileText className="h-4 w-4" />
                2. ZIP Flusso / PDF contenuto *
              </span>
              <input
                type="file"
                name="pdfs"
                accept=".pdf,.zip,application/pdf,application/zip"
                multiple
                className="file-input file-input-bordered file-input-sm w-full"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  pdfFilesRef.current = files;
                  setPdfNames(files.map((f) => f.name));
                }}
                required
              />
              {pdfNames.length > 0 && (
                <span className="label-text-alt mt-1">{pdfNames.join(", ")}</span>
              )}
              <span className="label-text-alt mt-1">
                Ogni riga CSV deve avere il PDF <code>{"{id_mediazione}.pdf"}</code> (anche dentro{" "}
                <code>_pdf.zip</code>). I file vengono salvati in Documenti come{" "}
                <strong>Contenuto raccomandata</strong>.
              </span>
            </label>
            <button
              type="submit"
              className="btn btn-primary btn-sm self-start"
              disabled={isSubmitting || csvNames.length === 0 || pdfNames.length === 0}
            >
              {isSubmitting ? "Analisi…" : "Anteprima"}
            </button>
          </div>
        </Form>
      )}

      {processResult && !actionData?.success && (
        <div className="space-y-4">
          <div className="rounded-lg border border-base-300 bg-base-100 p-4 text-sm space-y-2">
            <p className="font-medium">
              Anteprima: {validRows.length} importabili · {invalidRows.length} errori ·{" "}
              {existingSet.size} già presenti · {actionData?.pdfCount ?? 0} PDF nello ZIP
            </p>
            {(csvNames.length > 0 || pdfNames.length > 0) && (
              <p className="text-xs text-base-content/60">
                File: {[...csvNames, ...pdfNames].join(" · ")}
              </p>
            )}
          </div>

          {addable.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-base-300">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        checked={
                          addable.length > 0 &&
                          addable.every(({ index }) => selectedRows.includes(index))
                        }
                        onChange={() => {
                          const idxs = addable.map((a) => a.index);
                          const allOn = idxs.every((i) => selectedRows.includes(i));
                          setSelectedRows(
                            allOn
                              ? selectedRows.filter((i) => !idxs.includes(i))
                              : Array.from(new Set([...selectedRows, ...idxs])),
                          );
                        }}
                      />
                    </th>
                    <th>Mediazione</th>
                    <th>Numero</th>
                    <th>Data</th>
                    <th>Destinatario</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {addable.map(({ row, index }) => (
                    <tr key={`${row.numero}-${index}`}>
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={selectedRows.includes(index)}
                          onChange={() =>
                            setSelectedRows((prev) =>
                              prev.includes(index)
                                ? prev.filter((i) => i !== index)
                                : [...prev, index],
                            )
                          }
                        />
                      </td>
                      <td className="font-mono text-xs">
                        <Link
                          to={`/mediazioni/${row.mediazioneId}`}
                          className="link link-hover"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.mediazioneId}
                        </Link>
                      </td>
                      <td className="font-mono text-xs">{row.numero}</td>
                      <td className="whitespace-nowrap">
                        {row.data_invio_iso}
                        {row.usedDefaultNow ? " *" : ""}
                      </td>
                      <td className="max-w-[10rem] truncate">{row.destinatario ?? "—"}</td>
                      <td className="max-w-[8rem] truncate">
                        {row.link_status ? (
                          <a
                            href={row.link_status}
                            className="link link-primary"
                            target="_blank"
                            rel="noreferrer"
                          >
                            apri
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {invalidRows.length > 0 && (
            <div className="alert alert-warning py-2 text-xs max-h-40 overflow-y-auto">
              <ul className="list-disc pl-4">
                {invalidRows.slice(0, 40).map((r) => (
                  <li key={`${r.rowIndex}-${r.error}`}>
                    {r.error}
                    {r.data.numero ? ` (${r.data.numero})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body gap-3">
              <p className="text-sm text-base-content/70">
                Verranno usati i file già caricati per l&apos;anteprima — non serve selezionarli di
                nuovo.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={isSubmitting || selectedRows.length === 0}
                  onClick={handleImport}
                >
                  {isSubmitting
                    ? "Importazione…"
                    : `Importa ${selectedRows.length} raccomandate + PEC`}
                </button>
                <Link to="/mediazioni/convocazioni/upload" className="btn btn-ghost btn-sm">
                  Ricomincia
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
