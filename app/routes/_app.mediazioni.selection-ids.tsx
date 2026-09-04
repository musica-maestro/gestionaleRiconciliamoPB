import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

/**
 * Resource loader: returns every mediazione id matching current Da assegnare filters.
 * Used by the header checkbox 2nd click (select full filtered list).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  const canAssign = role === "admin" || role === "manager";
  if (!canAssign) {
    return json({ error: "Non autorizzato", ids: [] as string[] }, { status: 403 });
  }

  const { pb } = await createPB(request);
  const url = new URL(request.url);

  const filterAperte =
    `(data_chiusura = "" || data_chiusura = null || esito_finale = "" || esito_finale = null)`;
  const filterParts: string[] = [`${filterAperte} && stato = "registrata"`];

  const rgm = url.searchParams.get("rgm")?.trim() ?? "";
  const oggetto = url.searchParams.get("oggetto")?.trim() ?? "";
  const valore = url.searchParams.get("valore")?.trim() ?? "";
  const esito = url.searchParams.get("esito")?.trim() ?? "";
  const data_da = url.searchParams.get("data_da")?.trim() ?? "";
  const data_a = url.searchParams.get("data_a")?.trim() ?? "";
  const data_deposito_da = url.searchParams.get("data_deposito_da")?.trim() ?? "";
  const data_deposito_a = url.searchParams.get("data_deposito_a")?.trim() ?? "";
  const data_chiusura_da = url.searchParams.get("data_chiusura_da")?.trim() ?? "";
  const data_chiusura_a = url.searchParams.get("data_chiusura_a")?.trim() ?? "";
  const modalita = url.searchParams.get("modalita")?.trim() ?? "";
  const istante = url.searchParams.get("istante")?.trim() ?? "";
  const chiamato = url.searchParams.get("chiamato")?.trim() ?? "";
  const avvocato = url.searchParams.get("avvocato")?.trim() ?? "";
  const competenza = url.searchParams.get("competenza")?.trim() ?? "";
  const nota = url.searchParams.get("nota")?.trim() ?? "";
  const mediatore = url.searchParams.get("mediatore")?.trim() ?? "";

  if (rgm) filterParts.push(pb.filter("rgm ~ {:rgm}", { rgm }));
  if (oggetto) filterParts.push(pb.filter("oggetto ~ {:oggetto}", { oggetto }));
  if (valore) filterParts.push(pb.filter("valore ~ {:valore}", { valore }));
  if (esito) filterParts.push(`esito_finale = "${esito}"`);
  if (data_deposito_da) filterParts.push(`data_deposito >= "${data_deposito_da}"`);
  if (data_deposito_a) filterParts.push(`data_deposito <= "${data_deposito_a}"`);
  if (data_da) filterParts.push(`data_protocollo >= "${data_da}"`);
  if (data_a) filterParts.push(`data_protocollo <= "${data_a}"`);
  if (data_chiusura_da) filterParts.push(`data_chiusura >= "${data_chiusura_da}"`);
  if (data_chiusura_a) filterParts.push(`data_chiusura <= "${data_chiusura_a}"`);
  if (modalita) filterParts.push(pb.filter("modalita_mediazione ~ {:modalita}", { modalita }));
  if (istante) filterParts.push(pb.filter("istanti_testo ~ {:istante}", { istante }));
  if (chiamato) filterParts.push(pb.filter("chiamati_testo ~ {:chiamato}", { chiamato }));
  if (avvocato) filterParts.push(pb.filter("avvocati_testo ~ {:avvocato}", { avvocato }));
  if (competenza) filterParts.push(pb.filter("competenza ~ {:competenza}", { competenza }));
  if (nota) filterParts.push(pb.filter("nota ~ {:nota}", { nota }));
  if (mediatore) filterParts.push(pb.filter("mediatore_name ~ {:mediatore}", { mediatore }));

  const filter = filterParts.join(" && ");

  try {
    // Prefer slim fields; fall back if the view rejects field restriction.
    let all;
    try {
      all = await pb.collection("mediazioni_view").getFullList({
        filter,
        fields: "id",
        requestKey: null,
      });
    } catch {
      all = await pb.collection("mediazioni_view").getFullList({
        filter,
        requestKey: null,
      });
    }
    return json({ ids: all.map((r) => String(r.id)) });
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : "Impossibile caricare gli id",
        ids: [] as string[],
      },
      { status: 500 },
    );
  }
}
