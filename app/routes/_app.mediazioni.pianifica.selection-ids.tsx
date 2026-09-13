import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  const { pb } = await createPB(request);

  const url = new URL(request.url);
  const rgm = url.searchParams.get("rgm")?.trim() ?? "";
  const oggetto = url.searchParams.get("oggetto")?.trim() ?? "";
  const istante = url.searchParams.get("istante")?.trim() ?? "";
  const chiamato = url.searchParams.get("chiamato")?.trim() ?? "";
  const codice_cliente = url.searchParams.get("codice_cliente")?.trim() ?? "";

  const filterParts: string[] = [`stato = "assegnata"`];
  if (role === "mediatore") filterParts.push(`mediatore = "${user.id}"`);
  if (rgm) filterParts.push(pb.filter("rgm ~ {:rgm}", { rgm }));
  if (oggetto) filterParts.push(pb.filter("oggetto ~ {:oggetto}", { oggetto }));
  if (istante) filterParts.push(pb.filter("istanti_testo ~ {:istante}", { istante }));
  if (chiamato) filterParts.push(pb.filter("chiamati_testo ~ {:chiamato}", { chiamato }));
  if (codice_cliente) {
    filterParts.push(
      pb.filter("codice_univoco_cliente ~ {:codice_cliente}", { codice_cliente }),
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
