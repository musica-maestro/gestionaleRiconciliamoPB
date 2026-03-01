import { Form, useActionData, useSearchParams } from "@remix-run/react";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { getSession, commitSession, destroySession, SESSION_PB_TOKEN_KEY, SESSION_USER_KEY } from "~/lib/session.server";
import { createPB, getPocketBase } from "~/lib/pocketbase.server";
import type { PbUser } from "~/types";
import { isActiveUser } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await createPB(request);
  if (user?.id) throw redirect("/dashboard");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return json({ error: "Email e password richiesti" }, 400);
  }

  const pb = getPocketBase();
  try {
    const auth = await pb.collection("users").authWithPassword(email, password);
    const record = auth.record as unknown as PbUser;

    if (!isActiveUser(record)) {
      pb.authStore.clear();
      return json({ error: "Account disattivato. Contatta l'amministratore." }, 403);
    }

    const session = await getSession(request.headers.get("Cookie"));
    session.set(SESSION_PB_TOKEN_KEY, auth.token);
    const ruoli = record.ruoli ?? [];
    const ruoloCorrente =
      record.ruolo_corrente ??
      (Array.isArray(ruoli) ? ruoli[0] : ruoli) ??
      "mediatore";
    session.set(SESSION_USER_KEY, {
      id: record.id,
      email: record.email,
      name: record.name ?? "",
      stato: record.stato,
      ruoli: Array.isArray(ruoli) ? ruoli : [ruoli].filter(Boolean),
      ruolo_corrente: ruoloCorrente,
    } satisfies PbUser);

    return redirect("/dashboard", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  } catch (err: unknown) {
    const message = err && typeof err === "object" && "message" in err
      ? String((err as { message: string }).message)
      : "Credenziali non valide";
    return json({ error: message }, 401);
  }
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const error = actionData?.error ?? searchParams.get("error") === "disabled" ? "Account disattivato." : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <div className="card-body">
          <h1 className="card-title justify-center text-2xl text-base-content">
            Riconciliamo
          </h1>
          <Form method="post" className="space-y-4">
            <div className="form-control">
              <label htmlFor="email" className="label">
                <span className="label-text">Email</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="input input-bordered w-full bg-base-100 text-base-content"
              />
            </div>
            <div className="form-control">
              <label htmlFor="password" className="label">
                <span className="label-text">Password</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="input input-bordered w-full bg-base-100 text-base-content"
              />
            </div>
            {error && (
              <div className="alert alert-error text-sm" role="alert">
                <span>{error}</span>
              </div>
            )}
            <button type="submit" className="btn btn-primary w-full">
              Accedi
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}
