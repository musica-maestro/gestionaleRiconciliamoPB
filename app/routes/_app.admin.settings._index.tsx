import { Form, useLoaderData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

type Opzione = {
  id: string;
  nome: string;
  descrizione?: string;
  attivo: boolean;
};

type DocumentoTipo = {
  id: string;
  nome: string;
  descrizione?: string;
  attivo: boolean;
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);

  const [tipi, scaglioni, modalita, competenze, motivazioneDeposito, modalitaConvocazione, materia] = await Promise.all([
    pb.collection("documenti_tipi").getFullList<DocumentoTipo>({ sort: "nome" }).catch(() => [] as DocumentoTipo[]),
    pb.collection("scaglioni_mediazione").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
    pb.collection("modalita_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
    pb.collection("competenza_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
    pb.collection("motivazione_deposito_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
    pb.collection("modalita_convocazione_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
    pb.collection("materia_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
  ]);

  return json({ tipi, scaglioni, modalita, competenze, motivazioneDeposito, modalitaConvocazione, materia });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "add_tipo") {
    const nome = String(formData.get("nome") ?? "").trim();
    const descrizione = String(formData.get("descrizione") ?? "").trim() || undefined;
    if (!nome) return redirect("/admin/settings");
    await pb.collection("documenti_tipi").create({ nome, descrizione, attivo: true });
  } else if (intent === "toggle_tipo") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("documenti_tipi").update(id, { attivo: !current });
  } else if (intent === "add_scaglione") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return redirect("/admin/settings");
    await pb.collection("scaglioni_mediazione").create({ nome, attivo: true });
  } else if (intent === "toggle_scaglione") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("scaglioni_mediazione").update(id, { attivo: !current });
  } else if (intent === "add_modalita") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return redirect("/admin/settings");
    await pb.collection("modalita_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_modalita") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("modalita_opzioni").update(id, { attivo: !current });
  } else if (intent === "add_competenza") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return redirect("/admin/settings");
    await pb.collection("competenza_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_competenza") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("competenza_opzioni").update(id, { attivo: !current });
  } else if (intent === "add_motivazione_deposito") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return redirect("/admin/settings");
    await pb.collection("motivazione_deposito_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_motivazione_deposito") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("motivazione_deposito_opzioni").update(id, { attivo: !current });
  } else if (intent === "add_modalita_convocazione") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return redirect("/admin/settings");
    await pb.collection("modalita_convocazione_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_modalita_convocazione") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("modalita_convocazione_opzioni").update(id, { attivo: !current });
  } else if (intent === "add_materia") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return redirect("/admin/settings");
    await pb.collection("materia_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_materia") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("materia_opzioni").update(id, { attivo: !current });
  }

  return redirect("/admin/settings");
}

function OpzioneSection({
  title,
  description,
  addAction,
  toggleAction,
  items,
  nomePlaceholder,
  showDescrizione = false,
}: {
  title: string;
  description: string;
  addAction: string;
  toggleAction: string;
  items: Opzione[];
  nomePlaceholder: string;
  showDescrizione?: boolean;
}) {
  return (
    <section className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body space-y-4">
        <div>
          <h2 className="card-title text-base">{title}</h2>
          <p className="text-sm text-base-content/70">{description}</p>
        </div>

        <Form
          method="post"
          className={`grid gap-3 items-end ${showDescrizione ? "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]" : "md:grid-cols-[minmax(0,1fr)_auto]"}`}
        >
          <input type="hidden" name="_action" value={addAction} />
          <div>
            <label className="label py-0">
              <span className="label-text text-xs font-medium">Nome *</span>
            </label>
            <input
              name="nome"
              required
              className="input input-sm input-bordered w-full"
              placeholder={nomePlaceholder}
            />
          </div>
          {showDescrizione && (
            <div>
              <label className="label py-0">
                <span className="label-text text-xs font-medium">Descrizione</span>
              </label>
              <input
                name="descrizione"
                className="input input-sm input-bordered w-full"
                placeholder="Nota opzionale"
              />
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-sm mt-4 md:mt-0">
            Aggiungi
          </button>
        </Form>

        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Nome</th>
                {showDescrizione && <th>Descrizione</th>}
                <th className="w-28 text-center">Attivo</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={showDescrizione ? 3 : 2} className="text-center text-sm text-base-content/60 py-4">
                    Nessuna voce definita.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td className="align-top">
                      <span className="font-medium">{item.nome}</span>
                    </td>
                    {showDescrizione && (
                      <td className="align-top text-sm text-base-content/80">
                        {item.descrizione || "—"}
                      </td>
                    )}
                    <td className="align-top text-center">
                      <Form method="post">
                        <input type="hidden" name="_action" value={toggleAction} />
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="current" value={String(item.attivo)} />
                        <button
                          type="submit"
                          className={item.attivo ? "badge badge-success gap-1 cursor-pointer" : "badge badge-ghost gap-1 cursor-pointer"}
                        >
                          {item.attivo ? "Attivo" : "Disattivo"}
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function AdminSettingsIndex() {
  const { tipi, scaglioni, modalita, competenze, motivazioneDeposito, modalitaConvocazione, materia } =
    useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-base-content">Impostazioni applicazione</h1>
          <p className="mt-1 text-sm text-base-content/70">
            Gestisci le opzioni dei campi e i tipi di documento.
          </p>
        </div>
      </header>

      <OpzioneSection
        title="Tipi di documento"
        description="Disponibili nel menu quando carichi documenti nelle mediazioni."
        addAction="add_tipo"
        toggleAction="toggle_tipo"
        items={tipi}
        nomePlaceholder="es. Richiesta, Verbale, Consegna verbale"
        showDescrizione
      />

      <OpzioneSection
        title="Scaglioni di valore"
        description="Opzioni per il campo Valore nelle mediazioni (da PDF Domanda di mediazione)."
        addAction="add_scaglione"
        toggleAction="toggle_scaglione"
        items={scaglioni}
        nomePlaceholder="es. da € 1.001 a € 5.000"
      />

      <OpzioneSection
        title="Modalità di mediazione"
        description="Opzioni per il campo Modalità nelle mediazioni."
        addAction="add_modalita"
        toggleAction="toggle_modalita"
        items={modalita}
        nomePlaceholder="es. Modalità telematica, In presenza"
      />

      <OpzioneSection
        title="Motivazione deposito"
        description="Opzioni per il campo Motivazione deposito (Istanza depositata)."
        addAction="add_motivazione_deposito"
        toggleAction="toggle_motivazione_deposito"
        items={motivazioneDeposito}
        nomePlaceholder="es. Quale condizione di procedibilità"
      />

      <OpzioneSection
        title="Modalità convocazione"
        description="Opzioni per l'invio della convocazione (PEC, raccomandata)."
        addAction="add_modalita_convocazione"
        toggleAction="toggle_modalita_convocazione"
        items={modalitaConvocazione}
        nomePlaceholder="es. Pec alla parte"
      />

      <OpzioneSection
        title="Materia / Oggetto controversia"
        description="Opzioni per il campo Oggetto (materia della controversia)."
        addAction="add_materia"
        toggleAction="toggle_materia"
        items={materia}
        nomePlaceholder="es. Condominio, Locazione, Altro"
      />

      <OpzioneSection
        title="Competenze territoriali"
        description="Opzioni per il campo Competenza nelle mediazioni."
        addAction="add_competenza"
        toggleAction="toggle_competenza"
        items={competenze}
        nomePlaceholder="es. Roma, Milano, Napoli"
      />
    </div>
  );
}
