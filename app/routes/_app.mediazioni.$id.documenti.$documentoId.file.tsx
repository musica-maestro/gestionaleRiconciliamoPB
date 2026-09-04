import { type LoaderFunctionArgs } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

function canAccessMediazione(
  role: string | undefined,
  userId: string,
  mediatoreId: string | null
): boolean {
  if (role === "admin" || role === "manager") return true;
  if (role === "mediatore" && mediatoreId === userId) return true;
  return false;
}

/** PocketBase stores files as `name_xxxxxxxxxx.ext` — strip the random suffix for downloads. */
function stripPbFileSuffix(storedName: string): string {
  return storedName.replace(/_[a-z0-9]{10}(\.[^.]+)$/i, "$1");
}

function sanitizeDownloadPart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function buildDownloadFilename(opts: {
  storedName: string;
  rgm?: string;
  mediatoreName?: string;
  tipoNome?: string;
}): string {
  const stored = stripPbFileSuffix(opts.storedName);
  const ext = stored.includes(".") ? stored.slice(stored.lastIndexOf(".")) : "";
  const isPdf = ext.toLowerCase() === ".pdf" || stored.toLowerCase().endsWith(".pdf");
  const tipo = (opts.tipoNome ?? "").toLowerCase();
  const looksLikeLettera =
    (tipo.includes("lettera") && tipo.includes("incarico")) ||
    stored.toLowerCase().startsWith("lettera_incarico");

  // Lettera di incarico: always use a clear mediatore + RGM name
  if (looksLikeLettera) {
    const parts = ["Lettera_incarico"];
    const med = sanitizeDownloadPart(opts.mediatoreName ?? "");
    const rgm = sanitizeDownloadPart(opts.rgm ?? "");
    if (med) parts.push(med);
    if (rgm) parts.push(`RGM_${rgm}`);
    return `${parts.join("_")}${isPdf || !ext ? ".pdf" : ext}`;
  }

  return stored || `documento${ext || ""}`;
}

function contentDisposition(disposition: "inline" | "attachment", filename: string): string {
  const safeAscii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const mediazioneId = params.id;
  const documentoId = params.documentoId;
  if (!mediazioneId || !documentoId) {
    throw new Response("Not Found", { status: 404 });
  }

  const [mediazione, documento] = await Promise.all([
    pb.collection("mediazioni").getOne(mediazioneId, { expand: "mediatore" }),
    pb.collection("documenti").getOne(documentoId, { expand: "tipo" }),
  ]);

  const docMediazioneId =
    typeof documento.mediazione === "string"
      ? documento.mediazione
      : (documento.mediazione as { id?: string } | undefined)?.id;
  if (docMediazioneId !== mediazioneId) {
    throw new Response("Not Found", { status: 404 });
  }

  const role = getCurrentRole(user);
  const mediatoreId =
    typeof mediazione.mediatore === "string" ? mediazione.mediatore : mediazione.mediatore ?? null;
  if (!canAccessMediazione(role, user.id, mediatoreId)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const filename = typeof documento.file === "string" ? documento.file.trim() : "";
  if (!filename) {
    throw new Response("Not Found", { status: 404 });
  }

  const expand = documento.expand as { tipo?: { nome?: string } } | undefined;
  const mediazioneExpand = mediazione.expand as
    | { mediatore?: { name?: string; email?: string } }
    | undefined;
  const mediatoreName =
    mediazioneExpand?.mediatore?.name ||
    mediazioneExpand?.mediatore?.email ||
    "";

  const downloadName = buildDownloadFilename({
    storedName: filename,
    rgm: String(mediazione.rgm ?? ""),
    mediatoreName,
    tipoNome: expand?.tipo?.nome || String(documento.tipo ?? ""),
  });

  const fileToken = await pb.files.getToken();
  const fileUrl = pb.files.getUrl(documento, filename, { token: fileToken });
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok || !fileResponse.body) {
    throw new Response("File not found", { status: fileResponse.status || 404 });
  }

  const headers = new Headers();
  const contentType = fileResponse.headers.get("Content-Type") || "application/pdf";
  headers.set("Content-Type", contentType);
  const contentLength = fileResponse.headers.get("Content-Length");
  if (contentLength) headers.set("Content-Length", contentLength);

  const forceDownload = new URL(request.url).searchParams.get("download") === "1";
  const disposition = forceDownload ? "attachment" : "inline";
  headers.set("Content-Disposition", contentDisposition(disposition, downloadName));

  return new Response(fileResponse.body, {
    status: fileResponse.status,
    headers,
  });
}
