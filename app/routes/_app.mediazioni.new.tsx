import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { ESITO_FINALE_VALUES, normalizeEsitoFinale } from "~/lib/esito-finale";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);
  const materiaResp = await pb.collection("materia_opzioni").getFullList({
    filter: "attivo = true",
    sort: "nome",
  });
  return json({
    materiaOpzioni: materiaResp.map((r) => (r.nome as string) ?? "").filter(Boolean),
  });
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
  const esitoRaw = String(formData.get("esito_finale") ?? "").trim();
  const esito_finale = esitoRaw ? normalizeEsitoFinale(esitoRaw) : undefined;
  const trasmessa = String(formData.get("trasmessa") ?? "") === "true";
  const proposta_mediatore = String(formData.get("proposta_mediatore") ?? "") === "true";
  const esoneratiRaw = String(formData.get("numero_esonerati_gratuito_patrocinio") ?? "").trim();
  const numero_esonerati_gratuito_patrocinio = esoneratiRaw === ""
    ? 0
    : Math.max(0, Math.floor(Number(esoneratiRaw)) || 0);
  const materia_altro = String(formData.get("materia_altro") ?? "").trim() || undefined;

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
    trasmessa,
    proposta_mediatore,
    numero_esonerati_gratuito_patrocinio,
    materia_altro: oggetto.toLowerCase() === "altro" ? materia_altro : undefined,
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
  const { materiaOpzioni } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [oggetto, setOggetto] = useState("");

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
              <label htmlFor="oggetto" className={labelClass}>Oggetto / Materia</label>
              <input
                id="oggetto"
                name="oggetto"
                type="text"
                list="materia-list-new"
                value={oggetto}
                onChange={(e) => setOggetto(e.target.value)}
                className={inputClass}
              />
              <datalist id="materia-list-new">
                {materiaOpzioni.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>

            {oggetto.trim().toLowerCase() === "altro" && (
              <div className="sm:col-span-2">
                <label htmlFor="materia_altro" className={labelClass}>Materia (altro)</label>
                <input
                  id="materia_altro"
                  name="materia_altro"
                  type="text"
                  placeholder="Specifica la materia"
                  className={inputClass}
                />
              </div>
            )}

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
                {ESITO_FINALE_VALUES.map((esito) => (
                  <option key={esito} value={esito}>
                    {esito}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="numero_esonerati_gratuito_patrocinio" className={labelClass}>
                N. esonerati gratuito patrocinio
              </label>
              <input
                id="numero_esonerati_gratuito_patrocinio"
                name="numero_esonerati_gratuito_patrocinio"
                type="number"
                min={0}
                step={1}
                defaultValue={0}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-3 pt-6">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="trasmessa"
                  value="true"
                  className="rounded border-slate-300"
                />
                Trasmessa
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="proposta_mediatore"
                  value="true"
                  className="rounded border-slate-300"
                />
                Proposta mediatore
              </label>
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
