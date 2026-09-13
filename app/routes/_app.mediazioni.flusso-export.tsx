import { type ActionFunctionArgs } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import {
  buildFlussoNotificheZip,
  FlussoExportError,
} from "~/lib/flusso-notifiche.server";
import { createPB } from "~/lib/pocketbase.server";

const FILTER_APERTE =
  `(data_chiusura = "" || data_chiusura = null || esito_finale = "" || esito_finale = null)`;
const FILTER_DA_CONVOCARE =
  `${FILTER_APERTE} && (stato = "da_notificare" || stato = "pianificata")`;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function zipFilename(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return `flusso_notifiche_${stamp}.zip`;
}

/**
 * POST /mediazioni/flusso-export
 * Streams NDJSON progress lines then a zip binary (X-Export-Stream: progress+zip).
 * On any check/generation error: NDJSON error only — no ZIP.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  if (role !== "admin" && role !== "manager" && role !== "mediatore") {
    return new Response(JSON.stringify({ type: "error", message: "Non autorizzato" }) + "\n", {
      status: 403,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const { pb } = await createPB(request);
  const formData = await request.formData();

  const rgm = String(formData.get("rgm") ?? "").trim();
  const codice_cliente = String(formData.get("codice_cliente") ?? "").trim();
  const oggetto = String(formData.get("oggetto") ?? "").trim();
  const valore = String(formData.get("valore") ?? "").trim();
  const esito = String(formData.get("esito") ?? "").trim();
  const data_da = String(formData.get("data_da") ?? "").trim();
  const data_a = String(formData.get("data_a") ?? "").trim();
  const data_deposito_da = String(formData.get("data_deposito_da") ?? "").trim();
  const data_deposito_a = String(formData.get("data_deposito_a") ?? "").trim();
  const data_chiusura_da = String(formData.get("data_chiusura_da") ?? "").trim();
  const data_chiusura_a = String(formData.get("data_chiusura_a") ?? "").trim();
  const modalita = String(formData.get("modalita") ?? "").trim();
  const istante = String(formData.get("istante") ?? "").trim();
  const chiamato = String(formData.get("chiamato") ?? "").trim();
  const avvocato = String(formData.get("avvocato") ?? "").trim();
  const competenza = String(formData.get("competenza") ?? "").trim();
  const nota = String(formData.get("nota") ?? "").trim();
  const mediatore = String(formData.get("mediatore") ?? "").trim();

  const filterParts: string[] = [FILTER_DA_CONVOCARE];
  // Mediatore: only own mediazioni (same scope as the list tab)
  if (role === "mediatore") filterParts.push(`mediatore = "${user.id}"`);
  if (rgm) filterParts.push(pb.filter("rgm ~ {:rgm}", { rgm }));
  if (codice_cliente) {
    filterParts.push(
      pb.filter("codice_univoco_cliente ~ {:codice_cliente}", { codice_cliente }),
    );
  }
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
  // Ignore free-text mediatore filter when the user is already scoped to self
  if (mediatore && role !== "mediatore") {
    filterParts.push(pb.filter("mediatore_name ~ {:mediatore}", { mediatore }));
  }
  const filter = filterParts.join(" && ");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      try {
        let items: Array<{ id: string }>;
        try {
          items = await pb.collection("mediazioni_view").getFullList({
            filter,
            fields: "id",
            requestKey: null,
          });
        } catch {
          items = await pb.collection("mediazioni_view").getFullList({
            filter,
            requestKey: null,
          });
        }
        const ids = items.map((r) => String(r.id));
        if (ids.length === 0) {
          send({ type: "error", message: "Nessuna mediazione da convocare con i filtri correnti." });
          controller.close();
          return;
        }

        send({ type: "progress", phase: "check", current: 0, total: ids.length });

        const { zip, okCount, mailCount } = await buildFlussoNotificheZip(
          pb,
          ids,
          (event) =>
            send({
              type: "progress",
              phase: event.phase,
              current: event.current,
              total: event.total,
              label: event.label,
            }),
        );

        const filename = zipFilename();
        send({
          type: "zip",
          length: zip.length,
          filename,
          okCount,
          mailCount,
          total: ids.length,
        });
        const CHUNK = 64 * 1024;
        for (let offset = 0; offset < zip.length; offset += CHUNK) {
          controller.enqueue(new Uint8Array(zip.subarray(offset, offset + CHUNK)));
        }
      } catch (e) {
        if (e instanceof FlussoExportError) {
          send({ type: "error", message: e.message, errors: e.errors });
        } else {
          const message = e instanceof Error ? e.message : String(e);
          send({ type: "error", message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Export-Stream": "progress+zip",
      "Cache-Control": "no-store",
    },
  });
}
