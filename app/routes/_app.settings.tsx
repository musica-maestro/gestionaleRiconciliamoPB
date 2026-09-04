import { Form, useLoaderData, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import {
  Camera,
  CheckCircle2,
  FileSignature,
  KeyRound,
  Loader2,
  UserRound,
} from "lucide-react";
import { requireUser } from "~/lib/auth.server";
import { dataUrlToFirmaBlob, isUploadedFile } from "~/lib/form-data.server";
import { createPB, getPocketbaseBaseUrl } from "~/lib/pocketbase.server";
import { getSession, commitSession, SESSION_USER_KEY } from "~/lib/session.server";
import type { PbUser } from "~/types";
import { SignaturePad } from "~/components/signature-pad";

const RUOLI_OPTIONS = ["admin", "manager", "mediatore", "Ospite"];
const SESSO_OPTIONS = [
  { value: "male", label: "Maschio" },
  { value: "female", label: "Femmina" },
] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const sessionUser = await requireUser(request);
  const { pb } = await createPB(request);
  const baseUrl = getPocketbaseBaseUrl();

  let record: Record<string, unknown> = { ...sessionUser };
  try {
    record = (await pb.collection("users").getOne(sessionUser.id)) as Record<string, unknown>;
  } catch {
    // fallback to session
  }

  const avatar = typeof record.avatar === "string" ? record.avatar : undefined;
  const firma = typeof record.firma === "string" ? record.firma : undefined;
  const avatarUrl =
    avatar && sessionUser.id ? `${baseUrl}/api/files/users/${sessionUser.id}/${avatar}` : null;
  const firmaUrl =
    firma && sessionUser.id ? `${baseUrl}/api/files/users/${sessionUser.id}/${firma}` : null;

  return json({
    user: {
      id: sessionUser.id,
      email: (record.email as string) ?? sessionUser.email,
      name: (record.name as string) ?? sessionUser.name,
      ruolo_corrente: (record.ruolo_corrente as string) ?? sessionUser.ruolo_corrente,
      ruoli: Array.isArray(record.ruoli)
        ? (record.ruoli as string[])
        : sessionUser.ruoli ?? [],
      avatar,
      firma,
      sesso: (record.sesso as string) ?? "",
    },
    avatarUrl,
    firmaUrl,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const ruolo_corrente = String(formData.get("ruolo_corrente") ?? "").trim();
  const sesso = String(formData.get("sesso") ?? "").trim();
  const old_password = String(formData.get("old_password") ?? "").trim();
  const new_password = String(formData.get("new_password") ?? "").trim();
  const new_password_confirm = String(formData.get("new_password_confirm") ?? "").trim();
  const avatarFile = formData.get("avatar");
  const firmaFile = formData.get("firma");
  const firmaData = String(formData.get("firma_data") ?? "").trim();
  const removeFirma = formData.get("remove_firma") === "1";

  if (new_password || new_password_confirm) {
    if (new_password !== new_password_confirm) {
      return json({ error: "Le due password non coincidono." }, 400);
    }
    if (!old_password) {
      return json({ error: "Inserisci la password attuale per cambiare password." }, 400);
    }
  }

  const hasAvatar = isUploadedFile(avatarFile);
  const hasFirmaFile = isUploadedFile(firmaFile);
  const drawnFirma = !hasFirmaFile && !removeFirma ? dataUrlToFirmaBlob(firmaData) : null;
  const hasFirma = hasFirmaFile || drawnFirma != null;

  const { pb } = await createPB(request);

  try {
    const useFormData = hasAvatar || hasFirma || removeFirma;
    let updatedRecord: {
      name?: string;
      ruolo_corrente?: string;
      avatar?: string;
      firma?: string;
      sesso?: string;
    } = {};

    if (useFormData) {
      const pbForm = new FormData();
      if (name) pbForm.append("name", name);
      if (ruolo_corrente && user.ruoli?.includes(ruolo_corrente)) {
        pbForm.append("ruolo_corrente", ruolo_corrente);
      }
      if (sesso === "male" || sesso === "female") {
        pbForm.append("sesso", sesso);
      } else {
        pbForm.append("sesso", "");
      }
      if (new_password && new_password === new_password_confirm) {
        if (old_password) pbForm.append("oldPassword", old_password);
        pbForm.append("password", new_password);
        pbForm.append("passwordConfirm", new_password_confirm);
      }
      if (hasAvatar) pbForm.append("avatar", avatarFile);
      if (removeFirma) pbForm.append("firma", "");
      else if (hasFirmaFile) pbForm.append("firma", firmaFile);
      else if (drawnFirma) pbForm.append("firma", drawnFirma.blob, drawnFirma.filename);

      const result = (await pb.collection("users").update(user.id, pbForm)) as Record<
        string,
        unknown
      >;
      updatedRecord = {
        name: (result.name as string) ?? user.name,
        ruolo_corrente: (result.ruolo_corrente as string) ?? user.ruolo_corrente,
        avatar: typeof result.avatar === "string" ? result.avatar : user.avatar,
        firma: typeof result.firma === "string" ? result.firma : undefined,
        sesso: typeof result.sesso === "string" ? result.sesso : sesso,
      };
    } else {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (ruolo_corrente && user.ruoli?.includes(ruolo_corrente)) {
        body.ruolo_corrente = ruolo_corrente;
      }
      body.sesso = sesso === "male" || sesso === "female" ? sesso : "";
      if (new_password && new_password === new_password_confirm) {
        if (old_password) body.oldPassword = old_password;
        body.password = new_password;
        body.passwordConfirm = new_password_confirm;
      }
      const result = (await pb.collection("users").update(user.id, body)) as Record<
        string,
        unknown
      >;
      updatedRecord = {
        name: (result.name as string) ?? user.name,
        ruolo_corrente: (result.ruolo_corrente as string) ?? user.ruolo_corrente,
        sesso: typeof result.sesso === "string" ? result.sesso : sesso,
      };
    }

    const session = await getSession(request.headers.get("Cookie"));
    const updatedUser: PbUser = {
      ...user,
      name: updatedRecord.name ?? user.name,
      ruolo_corrente: updatedRecord.ruolo_corrente ?? user.ruolo_corrente,
      ...(updatedRecord.avatar !== undefined && { avatar: updatedRecord.avatar }),
      ...(updatedRecord.firma !== undefined && { firma: updatedRecord.firma }),
      ...(updatedRecord.sesso !== undefined && { sesso: updatedRecord.sesso }),
    };
    session.set(SESSION_USER_KEY, updatedUser);

    return redirect("/settings?saved=1", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  } catch (e) {
    console.error("Profile update error:", e);
    const err = e as {
      response?: { message?: string; data?: Record<string, { message?: string }> };
    };
    let message = "Impossibile aggiornare il profilo.";
    const data = err.response?.data;
    if (data && typeof data === "object") {
      const oldPw = data.oldPassword;
      if (
        oldPw &&
        typeof oldPw === "object" &&
        typeof (oldPw as { message?: string }).message === "string"
      ) {
        message = "Password attuale non corretta.";
      } else {
        const firstField = Object.values(data)[0];
        const fieldMsg =
          firstField && typeof firstField === "object" && "message" in firstField
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
  const { user, avatarUrl, firmaUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const saving = navigation.state === "submitting";
  const justSaved = searchParams.get("saved") === "1";
  const isMediatore =
    user.ruolo_corrente === "mediatore" || user.ruoli?.includes("mediatore");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-base-content tracking-tight">
            Il tuo profilo
          </h1>
          <p className="mt-1 text-sm text-base-content/65">
            Aggiorna i dati personali, la firma e la password.
          </p>
        </div>
        {justSaved && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Modifiche salvate
          </div>
        )}
      </header>

      <Form method="post" encType="multipart/form-data" className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Profile card */}
          <section className="lg:col-span-3 rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
            <div className="border-b border-base-200 bg-gradient-to-r from-[#3aaeba]/10 to-transparent px-5 py-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3aaeba]/15 text-[#2a8f99]">
                <UserRound className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-semibold text-base-content">Dati profilo</h2>
                <p className="text-xs text-base-content/60">Nome, foto e ruolo operativo</p>
              </div>
            </div>

            <div className="p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="relative shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Avatar"
                      className="h-20 w-20 rounded-2xl object-cover border border-base-300 shadow-sm"
                    />
                  ) : (
                    <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#3aaeba]/15 text-[#2a8f99] text-2xl font-semibold border border-[#3aaeba]/20">
                      {(user.name || user.email || "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-base-100 border border-base-300 shadow-sm text-base-content/70">
                    <Camera className="h-3.5 w-3.5" />
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <label className="label py-0 mb-1">
                    <span className="label-text text-xs font-medium">Cambia foto</span>
                  </label>
                  <input
                    type="file"
                    name="avatar"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="file-input file-input-bordered file-input-sm w-full"
                  />
                  <p className="mt-1 text-[11px] text-base-content/55">
                    PNG o JPG, preferibilmente quadrata.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="form-control w-full sm:col-span-2">
                  <label className="label py-1" htmlFor="email">
                    <span className="label-text text-xs font-medium">Email</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={user.email}
                    readOnly
                    className="input input-bordered w-full bg-base-200/70"
                  />
                </div>

                <div className="form-control w-full">
                  <label className="label py-1" htmlFor="name">
                    <span className="label-text text-xs font-medium">Nome visualizzato</span>
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    defaultValue={user.name}
                    className="input input-bordered w-full"
                    required
                  />
                </div>

                <div className="form-control w-full">
                  <label className="label py-1" htmlFor="sesso">
                    <span className="label-text text-xs font-medium">Sesso</span>
                  </label>
                  <select
                    id="sesso"
                    name="sesso"
                    defaultValue={user.sesso || ""}
                    className="select select-bordered w-full"
                  >
                    <option value="">— Non impostato —</option>
                    {SESSO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-base-content/55">
                    Serve per Dott./Dott.ssa nella lettera di incarico.
                  </p>
                </div>

                {Array.isArray(user.ruoli) && user.ruoli.length > 0 && (
                  <div className="form-control w-full sm:col-span-2">
                    <label className="label py-1" htmlFor="ruolo_corrente">
                      <span className="label-text text-xs font-medium">Ruolo corrente</span>
                    </label>
                    <select
                      id="ruolo_corrente"
                      name="ruolo_corrente"
                      defaultValue={user.ruolo_corrente ?? user.ruoli?.[0]}
                      className="select select-bordered w-full"
                    >
                      {RUOLI_OPTIONS.filter((r) => user.ruoli?.includes(r)).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Password card */}
          <section className="lg:col-span-2 rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
            <div className="border-b border-base-200 bg-gradient-to-r from-amber-500/10 to-transparent px-5 py-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700">
                <KeyRound className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-semibold text-base-content">Password</h2>
                <p className="text-xs text-base-content/60">Lascia vuoto per non cambiarla</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="form-control w-full">
                <label className="label py-1" htmlFor="old_password">
                  <span className="label-text text-xs font-medium">Password attuale</span>
                </label>
                <input
                  id="old_password"
                  name="old_password"
                  type="password"
                  autoComplete="current-password"
                  className="input input-bordered w-full"
                />
              </div>
              <div className="form-control w-full">
                <label className="label py-1" htmlFor="new_password">
                  <span className="label-text text-xs font-medium">Nuova password</span>
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
                <label className="label py-1" htmlFor="new_password_confirm">
                  <span className="label-text text-xs font-medium">Conferma nuova</span>
                </label>
                <input
                  id="new_password_confirm"
                  name="new_password_confirm"
                  type="password"
                  autoComplete="new-password"
                  className="input input-bordered w-full"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Firma card */}
        <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
          <div className="border-b border-base-200 bg-gradient-to-r from-violet-500/10 to-transparent px-5 py-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700">
              <FileSignature className="h-4 w-4" />
            </span>
            <div className="flex-1">
              <h2 className="font-semibold text-base-content">Firma digitale</h2>
              <p className="text-xs text-base-content/60">
                {isMediatore
                  ? "Inserita automaticamente nella lettera di incarico all’assegnazione."
                  : "Puoi disegnarla qui o caricare un’immagine."}
              </p>
            </div>
          </div>

          <div className="p-5">
            <SignaturePad existingUrl={firmaUrl} />
          </div>
        </section>

        {actionData?.error && (
          <div className="alert alert-error shadow-sm">
            <span>{actionData.error}</span>
          </div>
        )}

        <div className="flex justify-end sticky bottom-3 z-10">
          <button
            type="submit"
            disabled={saving}
            className="btn border-0 bg-[#3aaeba] hover:bg-[#349aa5] text-white shadow-lg px-6"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvataggio…
              </>
            ) : (
              "Salva modifiche"
            )}
          </button>
        </div>
      </Form>
    </div>
  );
}
