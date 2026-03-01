import { Form, useLoaderData, useActionData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { getSession, commitSession, SESSION_USER_KEY } from "~/lib/session.server";
import type { PbUser } from "~/types";

const RUOLI_OPTIONS = ["admin", "manager", "mediatore", "Ospite"];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return json({ user });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const ruolo_corrente = String(formData.get("ruolo_corrente") ?? "").trim();

  const { pb } = await createPB(request);
  try {
    await pb.collection("users").update(user.id, {
      ...(name && { name }),
      ...(ruolo_corrente && user.ruoli?.includes(ruolo_corrente) && { ruolo_corrente }),
    });
  } catch {
    return json({ error: "Impossibile aggiornare il profilo." }, 400);
  }

  const session = await getSession(request.headers.get("Cookie"));
  const updatedUser: PbUser = {
    ...user,
    name: name || user.name,
    ruolo_corrente: user.ruoli?.includes(ruolo_corrente) ? ruolo_corrente : user.ruolo_corrente,
  };
  session.set(SESSION_USER_KEY, updatedUser);

  return redirect("/settings", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function Settings() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-base-content mb-6">Impostazioni</h1>

      <div className="card bg-base-100 border border-base-300 max-w-xl">
        <div className="card-body">
          <h2 className="card-title text-lg">Profilo</h2>
          <Form method="post" className="space-y-4">
            <div className="form-control w-full">
              <label className="label" htmlFor="email">
                <span className="label-text">Email</span>
              </label>
              <input
                id="email"
                type="email"
                value={user.email}
                readOnly
                className="input input-bordered w-full bg-base-200"
              />
              <label className="label">
                <span className="label-text-alt text-base-content/60">Non modificabile</span>
              </label>
            </div>
            <div className="form-control w-full">
              <label className="label" htmlFor="name">
                <span className="label-text">Nome</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                defaultValue={user.name}
                className="input input-bordered w-full"
              />
            </div>
            {Array.isArray(user.ruoli) && user.ruoli.length > 0 && (
              <div className="form-control w-full">
                <label className="label" htmlFor="ruolo_corrente">
                  <span className="label-text">Ruolo corrente</span>
                </label>
                <select
                  id="ruolo_corrente"
                  name="ruolo_corrente"
                  defaultValue={user.ruolo_corrente ?? user.ruoli?.[0]}
                  className="select select-bordered w-full"
                >
                  {RUOLI_OPTIONS.filter((r) => user.ruoli?.includes(r)).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}
            {actionData?.error && (
              <div className="alert alert-error">
                <span>{actionData.error}</span>
              </div>
            )}
            <div className="card-actions justify-end pt-2">
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
