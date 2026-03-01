import { Form, Link, useLoaderData, useActionData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

const RUOLI_OPTIONS = ["admin", "manager", "mediatore", "Ospite"];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const id = params.id;
  if (!id) throw new Response("Not Found", { status: 404 });
  try {
    const u = (await pb.collection("users").getOne(id)) as Record<string, unknown>;
    return json({
      user: {
        id: u.id,
        email: (u.email as string) ?? "",
        name: (u.name as string) ?? "",
        ruolo_corrente: (u.ruolo_corrente as string) ?? "",
        ruoli: Array.isArray(u.ruoli) ? (u.ruoli as string[]) : [],
        stato: u.stato === true || (typeof u.stato !== "boolean" && u.stato !== false),
      },
    });
  } catch {
    throw new Response("Not Found", { status: 404 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const id = params.id;
  if (!id || request.method !== "POST") throw new Response("Bad Request", { status: 400 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const ruolo_corrente = String(formData.get("ruolo_corrente") ?? "").trim();
  const ruoli = formData.getAll("ruoli").map((v) => String(v).trim()).filter(Boolean);
  const stato = formData.get("stato") === "on" || formData.get("stato") === "1";

  const body: Record<string, unknown> = { stato };
  if (name) body.name = name;
  body.ruolo_corrente = ruolo_corrente || (ruoli[0] ?? "");
  body.ruoli = ruoli;

  try {
    await pb.collection("users").update(id, body);
  } catch (e) {
    console.error("Admin user update error:", e);
    return json(
      { error: "Impossibile aggiornare l'utente. Verificare i permessi della collection users." },
      { status: 400 }
    );
  }

  return redirect("/admin/utenti");
}

export default function AdminUtenteEdit() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <Link to="/admin/utenti" className="link link-hover text-sm">
          ← Gestione utenti
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-base-content mb-4">
        Modifica utente
      </h1>

      <div className="card bg-base-100 border-2 border-base-200 shadow-md max-w-xl rounded-xl overflow-hidden">
        <div className="card-body">
          <Form method="post" className="space-y-4">
            <div className="form-control w-full">
              <label className="label" htmlFor="email">
                <span className="label-text font-medium">Email</span>
              </label>
              <input
                id="email"
                type="email"
                value={user.email}
                readOnly
                className="input input-bordered w-full bg-base-200"
              />
              <span className="label-text-alt text-base-content/60">Solo lettura</span>
            </div>

            <div className="form-control w-full">
              <label className="label" htmlFor="name">
                <span className="label-text font-medium">Nome</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                defaultValue={user.name}
                className="input input-bordered w-full"
                placeholder="Nome visualizzato"
              />
            </div>

            <div className="form-control w-full">
              <span className="label-text font-medium mb-2 block">Ruoli assegnati</span>
              <div className="flex flex-wrap gap-4">
                {RUOLI_OPTIONS.map((ruolo) => (
                  <label key={ruolo} className="label cursor-pointer gap-2 justify-start">
                    <input
                      type="checkbox"
                      name="ruoli"
                      value={ruolo}
                      defaultChecked={user.ruoli.includes(ruolo)}
                      className="checkbox checkbox-sm"
                    />
                    <span className="label-text">{ruolo}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-control w-full">
              <label className="label" htmlFor="ruolo_corrente">
                <span className="label-text font-medium">Ruolo corrente</span>
              </label>
              <select
                id="ruolo_corrente"
                name="ruolo_corrente"
                defaultValue={user.ruolo_corrente}
                className="select select-bordered w-full"
              >
                <option value="">— Nessuno —</option>
                {RUOLI_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <span className="label-text-alt text-base-content/60">
                Ruolo con cui l&apos;utente opera nell&apos;app
              </span>
            </div>

            <div className="form-control">
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  name="stato"
                  value="1"
                  defaultChecked={user.stato}
                  className="checkbox checkbox-primary"
                />
                <span className="label-text font-medium">Utente attivo</span>
              </label>
              <span className="label-text-alt text-base-content/60">
                Se disattivo, l&apos;utente non può accedere
              </span>
            </div>

            {actionData?.error && (
              <div className="alert alert-error">
                <span>{actionData.error}</span>
              </div>
            )}

            <div className="card-actions justify-end pt-2">
              <Link to="/admin/utenti" className="btn btn-ghost">
                Annulla
              </Link>
              <button type="submit" className="btn btn-primary">
                Salva
              </button>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}
