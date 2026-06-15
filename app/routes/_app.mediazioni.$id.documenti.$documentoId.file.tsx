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

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const mediazioneId = params.id;
  const documentoId = params.documentoId;
  if (!mediazioneId || !documentoId) {
    throw new Response("Not Found", { status: 404 });
  }

  const [mediazione, documento] = await Promise.all([
    pb.collection("mediazioni").getOne(mediazioneId),
    pb.collection("documenti").getOne(documentoId),
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

  const fileToken = await pb.files.getToken();
  const fileUrl = pb.files.getUrl(documento, filename, { token: fileToken });
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok || !fileResponse.body) {
    throw new Response("File not found", { status: fileResponse.status || 404 });
  }

  const headers = new Headers();
  const contentType = fileResponse.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  const contentLength = fileResponse.headers.get("Content-Length");
  if (contentLength) headers.set("Content-Length", contentLength);

  const forceDownload = new URL(request.url).searchParams.get("download") === "1";
  const disposition = forceDownload ? "attachment" : "inline";
  headers.set("Content-Disposition", `${disposition}; filename="${filename.replace(/"/g, "")}"`);

  return new Response(fileResponse.body, {
    status: fileResponse.status,
    headers,
  });
}
