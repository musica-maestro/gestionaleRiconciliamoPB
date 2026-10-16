import { type LoaderFunctionArgs } from "@remix-run/node";
import * as XLSX from "xlsx";
import { requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import {
  buildRubricaRows,
  filterRubricaRows,
  parseRubricaFilters,
  sortRubricaRows,
} from "~/lib/rubrica.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);
  const url = new URL(request.url);
  const filters = parseRubricaFilters(url);
  const sort = url.searchParams.get("sort") || "display";
  const order = url.searchParams.get("order") === "desc" ? "desc" : "asc";

  const [soggettiResp, avvocatiResp] = await Promise.all([
    pb.collection("soggetti").getFullList({ sort: "nome,cognome,ragione_sociale" }),
    pb.collection("avvocati").getFullList({ sort: "cognome,nome" }),
  ]);

  const rows = sortRubricaRows(
    filterRubricaRows(
      buildRubricaRows(
        soggettiResp as Record<string, unknown>[],
        avvocatiResp as Record<string, unknown>[],
      ),
      filters,
    ),
    sort,
    order,
  );

  const excelRows = rows.map((r) => ({
    Tipo: r.tipoLabel,
    "Nome / Ragione sociale": r.display,
    "Codice fiscale": r.codice_fiscale,
    Comune: r.comune,
    Provincia: r.provincia,
    CAP: r.cap,
    "Email / PEC": r.email_pec,
    Telefono: r.telefono,
    Foro: r.foro,
  }));

  const ws = XLSX.utils.json_to_sheet(excelRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rubrica");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    headers: {
      "Content-Disposition": 'attachment; filename="rubrica.xlsx"',
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
