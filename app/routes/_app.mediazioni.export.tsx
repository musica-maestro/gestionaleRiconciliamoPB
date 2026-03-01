import { type LoaderFunctionArgs } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import * as XLSX from "xlsx";
import type { ExportFieldKey } from "~/components/export-mediazioni-dialog";

function stripHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, "").trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const role = getCurrentRole(user);

  const url = new URL(request.url);
  const fieldsParam = url.searchParams.getAll("fields") as ExportFieldKey[];
  const fields = fieldsParam.length > 0 ? fieldsParam : (["rgm", "oggetto", "valore", "istanti", "chiamati", "avvocati", "competenza", "nota", "modalita_mediazione", "motivazione_deposito", "modalita_convocazione", "mediatore_name", "esito_finale", "data_protocollo", "data_chiusura", "data_avvio_entro"] as ExportFieldKey[]);

  const rgm = url.searchParams.get("rgm")?.trim() ?? "";
  const oggetto = url.searchParams.get("oggetto")?.trim() ?? "";
  const valore = url.searchParams.get("valore")?.trim() ?? "";
  const esito = url.searchParams.get("esito")?.trim() ?? "";
  const data_da = url.searchParams.get("data_da")?.trim() ?? "";
  const data_a = url.searchParams.get("data_a")?.trim() ?? "";
  const data_chiusura_da = url.searchParams.get("data_chiusura_da")?.trim() ?? "";
  const data_chiusura_a = url.searchParams.get("data_chiusura_a")?.trim() ?? "";
  const modalita = url.searchParams.get("modalita")?.trim() ?? "";
  const istante = url.searchParams.get("istante")?.trim() ?? "";
  const chiamato = url.searchParams.get("chiamato")?.trim() ?? "";
  const avvocato = url.searchParams.get("avvocato")?.trim() ?? "";
  const competenza = url.searchParams.get("competenza")?.trim() ?? "";
  const nota = url.searchParams.get("nota")?.trim() ?? "";
  const mediatore = url.searchParams.get("mediatore")?.trim() ?? "";
  const sortField = url.searchParams.get("sort") ?? "data_protocollo";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
  const sort = order === "desc" ? `-${sortField}` : sortField;

  const filterParts: string[] = [];
  if (role === "mediatore") filterParts.push(`mediatore = "${user.id}"`);
  if (rgm) filterParts.push(pb.filter("rgm ~ {:rgm}", { rgm }));
  if (oggetto) filterParts.push(pb.filter("oggetto ~ {:oggetto}", { oggetto }));
  if (valore) filterParts.push(pb.filter("valore ~ {:valore}", { valore }));
  if (esito) filterParts.push(`esito_finale = "${esito}"`);
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
  const filter = filterParts.length > 0 ? filterParts.join(" && ") : undefined;

  const items = await pb.collection("mediazioni_view").getFullList({
    sort,
    ...(filter && { filter }),
  });

  const columnLabels: Record<string, string> = {
    rgm: "RGM",
    oggetto: "Oggetto",
    valore: "Valore",
    istanti: "Istanti",
    chiamati: "Chiamati",
    avvocati: "Avvocati",
    competenza: "Competenza",
    nota: "Nota",
    modalita_mediazione: "Modalità mediazione",
    motivazione_deposito: "Motivazione deposito",
    modalita_convocazione: "Modalità convocazione",
    mediatore_name: "Mediatore",
    esito_finale: "Esito",
    data_protocollo: "Data protocollo",
    data_chiusura: "Data chiusura",
    data_avvio_entro: "Data avvio entro",
  };

  const rows = items.map((m) => {
    const istanti = m.istanti_testo ? String(m.istanti_testo) : "";
    const chiamati = m.chiamati_testo ? String(m.chiamati_testo) : "";
    const avvocati = m.avvocati_testo ? String(m.avvocati_testo) : "";
    const notaStr = m.nota ? stripHtml(String(m.nota)) : "";
    const row: Record<string, string | null> = {};
    for (const key of fields) {
      switch (key) {
        case "rgm":
          row[columnLabels.rgm] = String(m.rgm ?? "");
          break;
        case "oggetto":
          row[columnLabels.oggetto] = String(m.oggetto ?? "");
          break;
        case "valore":
          row[columnLabels.valore] = String(m.valore ?? "");
          break;
        case "istanti":
          row[columnLabels.istanti] = istanti;
          break;
        case "chiamati":
          row[columnLabels.chiamati] = chiamati;
          break;
        case "avvocati":
          row[columnLabels.avvocati] = avvocati;
          break;
        case "competenza":
          row[columnLabels.competenza] = String(m.competenza ?? "");
          break;
        case "nota":
          row[columnLabels.nota] = notaStr;
          break;
        case "modalita_mediazione":
          row[columnLabels.modalita_mediazione] = String(m.modalita_mediazione ?? "");
          break;
        case "motivazione_deposito":
          row[columnLabels.motivazione_deposito] = String(m.motivazione_deposito ?? "");
          break;
        case "modalita_convocazione":
          row[columnLabels.modalita_convocazione] = String(m.modalita_convocazione ?? "");
          break;
        case "mediatore_name":
          row[columnLabels.mediatore_name] = String(m.mediatore_name ?? "");
          break;
        case "esito_finale":
          row[columnLabels.esito_finale] = String(m.esito_finale ?? "");
          break;
        case "data_protocollo":
          row[columnLabels.data_protocollo] = m.data_protocollo ? String(m.data_protocollo) : "";
          break;
        case "data_chiusura":
          row[columnLabels.data_chiusura] = m.data_chiusura ? String(m.data_chiusura) : "";
          break;
        case "data_avvio_entro":
          row[columnLabels.data_avvio_entro] = m.data_avvio_entro ? String(m.data_avvio_entro) : "";
          break;
      }
    }
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Mediazioni");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    headers: {
      "Content-Disposition": 'attachment; filename="mediazioni.xlsx"',
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
