import { type LoaderFunctionArgs } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { generateVerbaleDocx } from "~/lib/verbale.server";

function canAccessMediazione(
  role: string | undefined,
  userId: string,
  mediatoreId: string | null,
): boolean {
  if (role === "admin" || role === "manager") return true;
  if (role === "mediatore" && mediatoreId === userId) return true;
  return false;
}

function contentDisposition(filename: string): string {
  const safeAscii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

/** GET /mediazioni/:id/verbale?modello=...&incontro=... — filled Word verbale. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const id = params.id;
  if (!id) throw new Response("Not Found", { status: 404 });

  let mediazione: Record<string, unknown>;
  try {
    mediazione = (await pb.collection("mediazioni").getOne(id)) as Record<string, unknown>;
  } catch {
    throw new Response("Not Found", { status: 404 });
  }

  const role = getCurrentRole(user);
  const mediatoreId =
    typeof mediazione.mediatore === "string" ? mediazione.mediatore : null;
  if (!canAccessMediazione(role, user.id, mediatoreId)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const modello = url.searchParams.get("modello");
  const incontroId = url.searchParams.get("incontro");

  const result = await generateVerbaleDocx(pb, id, {
    modello,
    incontroId,
  });

  if ("error" in result) {
    throw new Response(result.error, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": contentDisposition(result.filename),
      "Cache-Control": "no-store",
    },
  });
}
