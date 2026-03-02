import { Form, useLoaderData, useActionData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/auth.server";
import { createPB, getPocketbaseBaseUrl } from "~/lib/pocketbase.server";
import { getSession, commitSession, SESSION_USER_KEY } from "~/lib/session.server";
import type { PbUser } from "~/types";

const RUOLI_OPTIONS = ["admin", "manager", "mediatore", "Ospite"];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const baseUrl = getPocketbaseBaseUrl();
  const avatarUrl =
    user.avatar && user.id
      ? `${baseUrl}/api/files/users/${user.id}/${user.avatar}`
      : null;
  return json({ user, avatarUrl });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const ruolo_corrente = String(formData.get("ruolo_corrente") ?? "").trim();
  const old_password = String(formData.get("old_password") ?? "").trim();
  const new_password = String(formData.get("new_password") ?? "").trim();
  const new_password_confirm = String(formData.get("new_password_confirm") ?? "").trim();
  const avatarFile = formData.get("avatar") as File | null;

  if (new_password || new_password_confirm) {
    if (new_password !== new_password_confirm) {
      return json({ error: "Le due password non coincidono." }, 400);
    }
    if (!old_password) {
      return json({ error: "Inserisci la password attuale per cambiare password." }, 400);
    }
  }

  const { pb } = await createPB(request);

  try {
    const useFormData = avatarFile && avatarFile.size > 0;
    let updatedRecord: { name?: string; ruolo_corrente?: string; avatar?: string } = {};

    if (useFormData) {
      const pbForm = new FormData();
      if (name) pbForm.append("name", name);
      if (ruolo_corrente && user.ruoli?.includes(ruolo_corrente)) {
        pbForm.append("ruolo_corrente", ruolo_corrente);
      }
      if (new_password && new_password === new_password_confirm) {
        if (old_password) pbForm.append("oldPassword", old_password);
        pbForm.append("password", new_password);
        pbForm.append("passwordConfirm", new_password_confirm);
      }
      pbForm.append("avatar", avatarFile);
      const result = (await pb.collection("users").update(user.id, pbForm)) as Record<string, unknown>;
      updatedRecord = {
        name: (result.name as string) ?? user.name,
        ruolo_corrente: (result.ruolo_corrente as string) ?? user.ruolo_corrente,
        avatar: typeof result.avatar === "string" ? result.avatar : user.avatar,
      };
    } else {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (ruolo_corrente && user.ruoli?.includes(ruolo_corrente)) {
        body.ruolo_corrente = ruolo_corrente;
      }
      if (new_password && new_password === new_password_confirm) {
        if (old_password) body.oldPassword = old_password;
        body.password = new_password;
        body.passwordConfirm = new_password_confirm;
      }
      if (Object.keys(body).length > 0) {
        const result = (await pb.collection("users").update(user.id, body)) as Record<string, unknown>;
        updatedRecord = {
          name: (result.name as string) ?? user.name,
          ruolo_corrente: (result.ruolo_corrente as string) ?? user.ruolo_corrente,
        };
      } else {
        updatedRecord = {
          name: name || user.name,
          ruolo_corrente: user.ruoli?.includes(ruolo_corrente) ? ruolo_corrente : user.ruolo_corrente,
        };
      }
    }

    const session = await getSession(request.headers.get("Cookie"));
    const updatedUser: PbUser = {
      ...user,
      name: updatedRecord.name ?? user.name,
      ruolo_corrente: updatedRecord.ruolo_corrente ?? user.ruolo_corrente,
      ...(updatedRecord.avatar !== undefined && { avatar: updatedRecord.avatar }),
    };
    session.set(SESSION_USER_KEY, updatedUser);

    return redirect("/settings", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  } catch (e) {
    console.error("Profile update error:", e);
    const err = e as { response?: { message?: string; data?: Record<string, { message?: string }> } };
    let message = "Impossibile aggiornare il profilo.";
    const data = err.response?.data;
    if (data && typeof data === "object") {
      const oldPw = data.oldPassword;
      if (oldPw && typeof oldPw === "object" && typeof (oldPw as { message?: string }).message === "string") {
        message = "Password attuale non corretta.";
      } else {
        const firstField = Object.values(data)[0];
        const fieldMsg = firstField && typeof firstField === "object" && "message" in firstField
          ? String((firstField as { message: string }).message)
          : null;
        if (fieldMsg) message = fieldMsg;
      }
    } else if (typeof err.response?.message === "string") {
      message = err.response.message;
    }
    return json({ error: message }, 400);
  }
}

export default function Settings() {
  const { user, avatarUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-base-content mb-6">Modifica profilo</h1>

      <Form method="post" encType="multipart/form-data">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <h2 className="card-title text-lg">Profilo</h2>
              <div className="space-y-4">
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Foto profilo</span>
                  </label>
                  <div className="flex items-center gap-4">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Avatar"
                        className="h-16 w-16 rounded-full object-cover border-2 border-base-300"
                      />
                    ) : (
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-base-300 text-base-content/70 text-2xl font-medium">
                        {(user.name || user.email || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <input
                      type="file"
                      name="avatar"
                      accept="image/*"
                      className="file-input file-input-bordered file-input-sm w-full max-w-xs"
                    />
                  </div>
                  <label className="label">
                    <span className="label-text-alt text-base-content/60">
                      JPG, PNG o GIF. Quadrato, max 2MB.
                    </span>
                  </label>
                </div>
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
              </div>
            </div>
          </div>

          <div className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <h2 className="card-title text-lg">Password</h2>
              <div className="space-y-4">
                <div className="form-control w-full">
                  <label className="label" htmlFor="old_password">
                    <span className="label-text">Password attuale</span>
                  </label>
                  <input
                    id="old_password"
                    name="old_password"
                    type="password"
                    autoComplete="current-password"
                    className="input input-bordered w-full"
                    placeholder="Solo per cambiare password"
                  />
                </div>
                <div className="form-control w-full">
                  <label className="label" htmlFor="new_password">
                    <span className="label-text">Nuova password</span>
                  </label>
                  <input
                    id="new_password"
                    name="new_password"
                    type="password"
                    autoComplete="new-password"
                    className="input input-bordered w-full"
                  />
                </div>
                <div className="form-control w-full">
                  <label className="label" htmlFor="new_password_confirm">
                    <span className="label-text">Conferma nuova password</span>
                  </label>
                  <input
                    id="new_password_confirm"
                    name="new_password_confirm"
                    type="password"
                    autoComplete="new-password"
                    className="input input-bordered w-full"
                  />
                </div>
                <p className="text-sm text-base-content/60">
                  Lascia i campi vuoti per mantenere la password attuale.
                </p>
              </div>
            </div>
          </div>
        </div>

        {actionData?.error && (
          <div className="alert alert-error mt-4 max-w-4xl">
            <span>{actionData.error}</span>
          </div>
        )}
        <div className="mt-4 flex justify-end max-w-4xl">
          <button type="submit" className="btn btn-primary">
            Salva
          </button>
        </div>
      </Form>
    </div>
  );
}
