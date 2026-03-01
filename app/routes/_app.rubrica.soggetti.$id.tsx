import { Form, Link, useLoaderData, useActionData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { useState } from "react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);
  const id = params.id;
  if (!id) throw new Response("Not Found", { status: 404 });
  try {
    const [s, partecipazioniResp] = await Promise.all([
      pb.collection("soggetti").getOne(id),
      pb.collection("partecipazioni").getFullList({
        filter: `soggetto = "${id}"`,
        expand: "mediazione",
      }),
    ]);
    const mediazioni = (partecipazioniResp as Record<string, unknown>[])
      .map((p) => (p.expand as Record<string, unknown>)?.mediazione as Record<string, unknown> | undefined)
      .filter(Boolean)
      .map((m) => ({
        id: m!.id,
        rgm: m!.rgm ?? "—",
        oggetto: m!.oggetto ?? "—",
        esito_finale: m!.esito_finale ?? "—",
        data_protocollo: m!.data_protocollo ?? null,
      }));
    // Deduplicate by mediazione id (same soggetto can be in multiple partecipazioni for same mediazione in theory)
    const seen = new Set<string>();
    const mediazioniUnique = mediazioni.filter((m) => {
      const k = String(m.id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return json({
      soggetto: {
        id: s.id,
        tipo: s.tipo ?? "Fisica",
        nome: s.nome ?? "",
        cognome: s.cognome ?? "",
        codice_fiscale: s.codice_fiscale ?? "",
        indirizzo_riga_1: s.indirizzo_riga_1 ?? "",
        indirizzo_riga_2: s.indirizzo_riga_2 ?? "",
        numero_civico: s.numero_civico ?? "",
        comune: s.comune ?? "",
        provincia: s.provincia ?? "",
        cap: s.cap ?? "",
        paese: s.paese ?? "",
        email: s.email ?? "",
        ragione_sociale: s.ragione_sociale ?? "",
        piva: s.piva ?? "",
        pec: s.pec ?? "",
      },
      mediazioni: mediazioniUnique,
    });
  } catch {
    throw new Response("Not Found", { status: 404 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);
  const id = params.id;
  if (!id || request.method !== "POST") throw new Response("Bad Request", { status: 400 });
  const formData = await request.formData();
  const tipo = String(formData.get("tipo") ?? "Fisica");
  const body: Record<string, unknown> = {
    tipo,
    nome: String(formData.get("nome") ?? "").trim() || undefined,
    cognome: String(formData.get("cognome") ?? "").trim() || undefined,
    codice_fiscale: String(formData.get("codice_fiscale") ?? "").trim() || undefined,
    indirizzo_riga_1: String(formData.get("indirizzo_riga_1") ?? "").trim() || undefined,
    indirizzo_riga_2: String(formData.get("indirizzo_riga_2") ?? "").trim() || undefined,
    numero_civico: String(formData.get("numero_civico") ?? "").trim() || undefined,
    comune: String(formData.get("comune") ?? "").trim() || undefined,
    provincia: String(formData.get("provincia") ?? "").trim() || undefined,
    cap: String(formData.get("cap") ?? "").trim() || undefined,
    paese: String(formData.get("paese") ?? "").trim() || undefined,
    email: String(formData.get("email") ?? "").trim() || undefined,
    ragione_sociale: String(formData.get("ragione_sociale") ?? "").trim() || undefined,
    piva: String(formData.get("piva") ?? "").trim() || undefined,
    pec: String(formData.get("pec") ?? "").trim() || undefined,
  };
  await pb.collection("soggetti").update(id, body);
  return redirect(`/rubrica/soggetti/${id}`);
}

function FieldView({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value || "—"}</dd>
    </div>
  );
}

export default function SoggettoDetail() {
  const { soggetto, mediazioni } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [editMode, setEditMode] = useState(false);

  const displayName = soggetto.tipo === "Giuridica" ? soggetto.ragione_sociale || "Soggetto" : `${soggetto.nome} ${soggetto.cognome}`.trim() || "Soggetto";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/rubrica" className="text-sm text-slate-600 hover:text-slate-900">
          ← Rubrica
        </Link>
        {!editMode ? (
          <button
            type="button"
            onClick={() => setEditMode(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Modifica
          </button>
        ) : null}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-2xl">
        <h1 className="text-xl font-semibold text-slate-800 mb-4">{displayName}</h1>

        {!editMode ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldView label="Tipo" value={soggetto.tipo} />
            <FieldView label="Codice fiscale" value={soggetto.codice_fiscale} />
            {soggetto.tipo === "Fisica" && (
              <>
                <FieldView label="Nome" value={soggetto.nome} />
                <FieldView label="Cognome" value={soggetto.cognome} />
                <FieldView label="Email" value={soggetto.email} />
              </>
            )}
            {soggetto.tipo === "Giuridica" && (
              <>
                <FieldView label="Ragione sociale" value={soggetto.ragione_sociale} />
                <FieldView label="P.IVA" value={soggetto.piva} />
                <FieldView label="PEC" value={soggetto.pec} />
              </>
            )}
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-slate-500">Indirizzo</dt>
              <dd className="mt-0.5 text-slate-900">
                {[soggetto.indirizzo_riga_1, soggetto.indirizzo_riga_2, soggetto.numero_civico, soggetto.cap, soggetto.comune, soggetto.provincia, soggetto.paese].filter(Boolean).join(", ") || "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <Form method="post" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Tipo</label>
              <select name="tipo" defaultValue={soggetto.tipo} className="mt-1 w-full rounded border border-slate-300 px-3 py-2">
                <option value="Fisica">Fisica</option>
                <option value="Giuridica">Giuridica</option>
              </select>
            </div>
            {soggetto.tipo === "Fisica" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Nome</label>
                    <input name="nome" defaultValue={soggetto.nome} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Cognome</label>
                    <input name="cognome" defaultValue={soggetto.cognome} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Email</label>
                  <input name="email" type="email" defaultValue={soggetto.email} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
                </div>
              </>
            )}
            {soggetto.tipo === "Giuridica" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Ragione sociale</label>
                  <input name="ragione_sociale" defaultValue={soggetto.ragione_sociale} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">P.IVA</label>
                  <input name="piva" defaultValue={soggetto.piva} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">PEC</label>
                  <input name="pec" type="email" defaultValue={soggetto.pec} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700">Codice fiscale</label>
              <input name="codice_fiscale" defaultValue={soggetto.codice_fiscale} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Indirizzo</label>
                <input name="indirizzo_riga_1" defaultValue={soggetto.indirizzo_riga_1} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Indirizzo (riga 2)</label>
                <input name="indirizzo_riga_2" defaultValue={soggetto.indirizzo_riga_2} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">N. civico</label>
                <input name="numero_civico" defaultValue={soggetto.numero_civico} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Comune</label>
                <input name="comune" defaultValue={soggetto.comune} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Provincia</label>
                <input name="provincia" defaultValue={soggetto.provincia} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" maxLength={2} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">CAP</label>
                <input name="cap" defaultValue={soggetto.cap} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Paese</label>
                <input name="paese" defaultValue={soggetto.paese} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </div>
            </div>
            {actionData?.error && <p className="text-sm text-red-600">{actionData.error}</p>}
            <div className="flex gap-2">
              <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Salva
              </button>
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annulla
              </button>
            </div>
          </Form>
        )}
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Mediazioni</h2>
        {mediazioni.length === 0 ? (
          <p className="text-slate-500 text-sm">Nessuna mediazione associata a questo soggetto.</p>
        ) : (
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                <th className="text-left font-medium text-slate-600">RGM</th>
                <th className="text-left font-medium text-slate-600">Oggetto</th>
                <th className="text-left font-medium text-slate-600">Esito</th>
                <th className="text-left font-medium text-slate-600">Data protocollo</th>
              </tr>
            </thead>
            <tbody>
              {mediazioni.map((m) => (
                <tr key={String(m.id)} className="hover">
                  <td>
                    <Link to={`/mediazioni/${m.id}`} className="link link-hover font-medium">
                      {String(m.rgm)}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate" title={String(m.oggetto)}>{String(m.oggetto)}</td>
                  <td>{String(m.esito_finale)}</td>
                  <td>{m.data_protocollo ? new Date(String(m.data_protocollo)).toLocaleDateString("it-IT") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
