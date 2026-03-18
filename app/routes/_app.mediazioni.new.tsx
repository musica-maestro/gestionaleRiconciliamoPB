import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  const { pb, user } = await createPB(request);
  if (!user?.id) throw redirect("/login");

  const formData = await request.formData();
  const rgm = String(formData.get("rgm") ?? "").trim();
  const oggetto = String(formData.get("oggetto") ?? "").trim();
  const valore = String(formData.get("valore") ?? "").trim();
  const data_deposito = formData.get("data_deposito")
    ? String(formData.get("data_deposito"))
    : null;
  const data_protocollo = formData.get("data_protocollo")
    ? String(formData.get("data_protocollo"))
    : null;
  const data_avvio_entro = formData.get("data_avvio_entro")
    ? String(formData.get("data_avvio_entro"))
    : null;
  const modalita_mediazione = String(formData.get("modalita_mediazione") ?? "").trim() || undefined;
  const motivazione_deposito = String(formData.get("motivazione_deposito") ?? "").trim() || undefined;
  const modalita_convocazione = String(formData.get("modalita_convocazione") ?? "").trim() || undefined;
  const esito_finale = String(formData.get("esito_finale") ?? "").trim() || undefined;

  const body: Record<string, unknown> = {
    rgm: rgm || undefined,
    oggetto: oggetto || undefined,
    valore: valore || undefined,
    data_deposito: data_deposito || undefined,
    data_protocollo: data_protocollo || undefined,
    data_avvio_entro: data_avvio_entro || undefined,
    modalita_mediazione: modalita_mediazione || undefined,
    motivazione_deposito: motivazione_deposito || undefined,
    modalita_convocazione: modalita_convocazione || undefined,
    esito_finale: esito_finale || undefined,
    mediatore: user.id,
  };

  try {
    const record = await pb.collection("mediazioni").create(body);
    return redirect(`/mediazioni/${record.id}`);
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: string }).message)
        : "Errore durante la creazione";
    return json({ error: message }, 400);
  }
}

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 text-sm";
const labelClass = "block text-sm font-medium text-slate-700";

export default function NewMediazione() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <div className="mb-6">
        <Link to="/mediazioni" className="text-sm text-slate-600 hover:text-slate-900">
          ← Elenco mediazioni
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-4xl">
        <h1 className="text-xl font-semibold text-slate-800 mb-5">Nuova mediazione</h1>

        <Form method="post">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Row 1: RGM | Oggetto */}
            <div>
              <label htmlFor="rgm" className={labelClass}>RGM</label>
              <input id="rgm" name="rgm" type="text" className={inputClass} />
            </div>
            <div>
              <label htmlFor="oggetto" className={labelClass}>Oggetto</label>
              <input id="oggetto" name="oggetto" type="text" className={inputClass} />
            </div>

            {/* Row 2: Data deposito | Data protocollo */}
            <div>
              <label htmlFor="data_deposito" className={labelClass}>Data deposito</label>
              <input id="data_deposito" name="data_deposito" type="date" className={inputClass} />
            </div>
            <div>
              <label htmlFor="data_protocollo" className={labelClass}>Data protocollo</label>
              <input id="data_protocollo" name="data_protocollo" type="date" className={inputClass} />
            </div>

            {/* Row 3: Valore | Modalità mediazione */}
            <div>
              <label htmlFor="valore" className={labelClass}>Valore</label>
              <input id="valore" name="valore" type="text" className={inputClass} />
            </div>
            <div>
              <label htmlFor="modalita_mediazione" className={labelClass}>Modalità mediazione</label>
              <select id="modalita_mediazione" name="modalita_mediazione" className={inputClass}>
                <option value="">—</option>
                <option value="Telematica">Telematica</option>
                <option value="Presenza">Presenza</option>
                <option value="Da remoto">Da remoto</option>
                <option value="Mista">Mista</option>
              </select>
            </div>

            {/* Row 4: Motivazione deposito | Data avvio entro */}
            <div>
              <label htmlFor="motivazione_deposito" className={labelClass}>Motivazione deposito</label>
              <input
                id="motivazione_deposito"
                name="motivazione_deposito"
                type="text"
                placeholder="es. Quale condizione di procedibilità"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="data_avvio_entro" className={labelClass}>
                Data avvio entro
                <span className="ml-1 text-slate-400 font-normal text-xs">(se disposta dal giudice)</span>
              </label>
              <input
                id="data_avvio_entro"
                name="data_avvio_entro"
                type="date"
                className={inputClass}
              />
            </div>

            {/* Row 5: Modalità convocazione | Esito finale */}
            <div>
              <label htmlFor="modalita_convocazione" className={labelClass}>Modalità convocazione</label>
              <input
                id="modalita_convocazione"
                name="modalita_convocazione"
                type="text"
                placeholder="es. Raccomandata, PEC alla parte"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="esito_finale" className={labelClass}>Esito finale</label>
              <select id="esito_finale" name="esito_finale" className={inputClass}>
                <option value="">—</option>
                <option value="Accordo">Accordo</option>
                <option value="Mancato accordo">Mancato accordo</option>
                <option value="Ritirata">Ritirata</option>
                <option value="Chiusa d'ufficio">Chiusa d&apos;ufficio</option>
                <option value="Nessuna risposta">Nessuna risposta</option>
              </select>
            </div>

          </div>

          {actionData?.error && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {actionData.error}
            </p>
          )}

          <div className="flex gap-3 pt-5 border-t border-slate-100 mt-5">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Salvataggio…" : "Crea mediazione"}
            </button>
            <Link
              to="/mediazioni"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Annulla
            </Link>
          </div>
        </Form>
      </div>
    </div>
  );
}
