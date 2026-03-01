import { Form, Link, useLoaderData } from "@remix-run/react";
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
    const [a, partecipazioniResp] = await Promise.all([
      pb.collection("avvocati").getOne(id),
      pb.collection("partecipazioni").getFullList({
        filter: `avvocati ?= "${id}"`,
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
    const seen = new Set<string>();
    const mediazioniUnique = mediazioni.filter((m) => {
      const k = String(m.id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return json({
      avvocato: {
        id: a.id,
        nome: a.nome ?? "",
        cognome: a.cognome ?? "",
        pec: a.pec ?? "",
        telefono: a.telefono ?? "",
        numero_tessera_foro: a.numero_tessera_foro ?? "",
        foro_di_appartenenza: a.foro_di_appartenenza ?? "",
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
  await pb.collection("avvocati").update(id, {
    nome: String(formData.get("nome") ?? "").trim() || undefined,
    cognome: String(formData.get("cognome") ?? "").trim() || undefined,
    pec: String(formData.get("pec") ?? "").trim() || undefined,
    telefono: String(formData.get("telefono") ?? "").trim() || undefined,
    numero_tessera_foro: String(formData.get("numero_tessera_foro") ?? "").trim() || undefined,
    foro_di_appartenenza: String(formData.get("foro_di_appartenenza") ?? "").trim() || undefined,
  });
  return redirect(`/rubrica/avvocati/${id}`);
}

function FieldView({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value || "—"}</dd>
    </div>
  );
}

export default function AvvocatoDetail() {
  const { avvocato, mediazioni } = useLoaderData<typeof loader>();
  const [editMode, setEditMode] = useState(false);

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
        <h1 className="text-xl font-semibold text-slate-800 mb-4">
          {[avvocato.nome, avvocato.cognome].filter(Boolean).join(" ") || "Avvocato"}
        </h1>

        {!editMode ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldView label="Nome" value={avvocato.nome} />
            <FieldView label="Cognome" value={avvocato.cognome} />
            <FieldView label="PEC" value={avvocato.pec} />
            <FieldView label="Telefono" value={avvocato.telefono} />
            <FieldView label="N. tessera foro" value={avvocato.numero_tessera_foro} />
            <FieldView label="Foro di appartenenza" value={avvocato.foro_di_appartenenza} />
          </dl>
        ) : (
          <Form method="post" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Nome</label>
                <input name="nome" defaultValue={avvocato.nome} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Cognome</label>
                <input name="cognome" defaultValue={avvocato.cognome} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">PEC</label>
              <input name="pec" type="email" defaultValue={avvocato.pec} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Telefono</label>
              <input name="telefono" defaultValue={avvocato.telefono} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">N. tessera foro</label>
              <input name="numero_tessera_foro" defaultValue={avvocato.numero_tessera_foro} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Foro di appartenenza</label>
              <input name="foro_di_appartenenza" defaultValue={avvocato.foro_di_appartenenza} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
            </div>
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
          <p className="text-slate-500 text-sm">Nessuna mediazione associata a questo avvocato.</p>
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
