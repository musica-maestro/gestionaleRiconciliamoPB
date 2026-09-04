import { Form, Link, useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { CSSProperties } from "react";
import { ArrowLeft, FileSignature, Loader2, UserRound } from "lucide-react";
import { requireUserAndRole } from "~/lib/auth.server";
import { dataUrlToFirmaBlob, isUploadedFile } from "~/lib/form-data.server";
import { createPB, getPocketbaseBaseUrl } from "~/lib/pocketbase.server";
import { SignaturePad } from "~/components/signature-pad";

const RUOLI_OPTIONS = ["admin", "manager", "mediatore", "Ospite"];
const SESSO_OPTIONS = [
  { value: "male", label: "Maschio" },
  { value: "female", label: "Femmina" },
] as const;

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const id = params.id;
  if (!id) throw new Response("Not Found", { status: 404 });
  try {
    const u = (await pb.collection("users").getOne(id)) as Record<string, unknown>;
    const baseUrl = getPocketbaseBaseUrl();
    const firma = typeof u.firma === "string" ? u.firma : "";
    const firmaUrl =
      firma && u.id ? `${baseUrl}/api/files/users/${u.id}/${firma}` : null;
    return json({
      user: {
        id: u.id as string,
        email: (u.email as string) ?? "",
        name: (u.name as string) ?? "",
        ruolo_corrente: (u.ruolo_corrente as string) ?? "",
        ruoli: Array.isArray(u.ruoli) ? (u.ruoli as string[]) : [],
        stato: u.stato === true || (typeof u.stato !== "boolean" && u.stato !== false),
        sesso: (u.sesso as string) ?? "",
        firma,
        firmaUrl,
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
  const sesso = String(formData.get("sesso") ?? "").trim();
  const firmaFile = formData.get("firma");
  const firmaData = String(formData.get("firma_data") ?? "").trim();
  const removeFirma = formData.get("remove_firma") === "1";

  const hasFirmaUpload = isUploadedFile(firmaFile);
  const drawnFirma = !hasFirmaUpload && !removeFirma ? dataUrlToFirmaBlob(firmaData) : null;
  const hasFirma = hasFirmaUpload || drawnFirma != null;

  try {
    if (hasFirma || removeFirma) {
      const pbForm = new FormData();
      if (name) pbForm.append("name", name);
      pbForm.append("ruolo_corrente", ruolo_corrente || (ruoli[0] ?? ""));
      for (const r of ruoli) pbForm.append("ruoli", r);
      pbForm.append("stato", stato ? "true" : "false");
      if (sesso === "male" || sesso === "female") {
        pbForm.append("sesso", sesso);
      } else {
        pbForm.append("sesso", "");
      }
      if (removeFirma) {
        pbForm.append("firma", "");
      } else if (hasFirmaUpload) {
        pbForm.append("firma", firmaFile);
      } else if (drawnFirma) {
        pbForm.append("firma", drawnFirma.blob, drawnFirma.filename);
      }
      await pb.collection("users").update(id, pbForm);
    } else {
      const body: Record<string, unknown> = { stato };
      if (name) body.name = name;
      body.ruolo_corrente = ruolo_corrente || (ruoli[0] ?? "");
      body.ruoli = ruoli;
      body.sesso = sesso === "male" || sesso === "female" ? sesso : "";
      await pb.collection("users").update(id, body);
    }
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
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link
          to="/admin/utenti"
          className="inline-flex items-center gap-1.5 text-sm text-base-content/65 hover:text-[#3aaeba] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Gestione utenti
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-base-content tracking-tight">
          Modifica utente
        </h1>
        <p className="mt-1 text-sm text-base-content/65">{user.email}</p>
      </div>

      <Form method="post" encType="multipart/form-data" className="space-y-5">
        <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
          <div className="border-b border-base-200 bg-gradient-to-r from-[#3aaeba]/10 to-transparent px-5 py-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3aaeba]/15 text-[#2a8f99]">
              <UserRound className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-semibold">Anagrafica e ruoli</h2>
              <p className="text-xs text-base-content/60">Dati base e permessi operativi</p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="form-control w-full">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="form-control w-full">
                <label className="label py-1" htmlFor="name">
                  <span className="label-text text-xs font-medium">Nome</span>
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
              </div>
            </div>

            <div className="form-control w-full">
              <span className="label-text text-xs font-medium mb-2 block">Ruoli assegnati</span>
              <div className="flex flex-wrap gap-3">
                {RUOLI_OPTIONS.map((ruolo) => (
                  <label
                    key={ruolo}
                    className="inline-flex items-center gap-2 rounded-lg border border-base-300 px-3 py-2 cursor-pointer hover:bg-base-200/50"
                  >
                    <input
                      type="checkbox"
                      name="ruoli"
                      value={ruolo}
                      defaultChecked={user.ruoli.includes(ruolo)}
                      className="checkbox checkbox-sm"
                    />
                    <span className="label-text text-sm">{ruolo}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-control w-full">
              <label className="label py-1" htmlFor="ruolo_corrente">
                <span className="label-text text-xs font-medium">Ruolo corrente</span>
              </label>
              <select
                id="ruolo_corrente"
                name="ruolo_corrente"
                defaultValue={user.ruolo_corrente}
                className="select select-bordered w-full"
              >
                <option value="">— Nessuno —</option>
                {RUOLI_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="stato"
                value="1"
                defaultChecked={user.stato}
                className="toggle toggle-sm"
                style={{ "--tglbg": user.stato ? "#3aaeba" : undefined } as CSSProperties}
              />
              <span className="text-sm font-medium">Utente attivo</span>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
          <div className="border-b border-base-200 bg-gradient-to-r from-violet-500/10 to-transparent px-5 py-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700">
              <FileSignature className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-semibold">Firma</h2>
              <p className="text-xs text-base-content/60">
                Disegna o carica — usata nella lettera di incarico
              </p>
            </div>
          </div>

          <div className="p-5">
            <SignaturePad existingUrl={user.firmaUrl} />
          </div>
        </section>

        {actionData?.error && (
          <div className="alert alert-error">
            <span>{actionData.error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link to="/admin/utenti" className="btn btn-ghost">
            Annulla
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="btn border-0 bg-[#3aaeba] hover:bg-[#349aa5] text-white"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvataggio…
              </>
            ) : (
              "Salva"
            )}
          </button>
        </div>
      </Form>
    </div>
  );
}
