import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  const { pb } = await createPB(request);

  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("q")?.trim() ?? "";

  const filterParts: string[] = [`stato = "assegnata"`];
  if (role === "mediatore") filterParts.push(`mediatore = "${user.id}"`);
  if (searchTerm) {
    filterParts.push(
      pb.filter(
        "(rgm ~ {:q} || oggetto ~ {:q} || istanti_testo ~ {:q} || chiamati_testo ~ {:q} || mediatore_name ~ {:q})",
        { q: searchTerm },
      ),
    );
  }
  const filter = filterParts.join(" && ");

  try {
    let all;
    try {
      all = await pb.collection("mediazioni_view").getFullList({ filter, fields: "id", requestKey: null });
    } catch {
      all = await pb.collection("mediazioni_view").getFullList({ filter, requestKey: null });
    }
    return json({ ids: all.map((r) => String(r.id)) });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Errore", ids: [] as string[] },
      { status: 500 },
    );
  }
}
