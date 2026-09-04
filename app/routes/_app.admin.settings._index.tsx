import { Form, useLoaderData, useSearchParams } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { ComponentType } from "react";
import {
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  ListChecks,
  MapPin,
  Plus,
  Scale,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { requireUserAndRole } from "~/lib/auth.server";
import { isUploadedFile } from "~/lib/form-data.server";
import { createPB, getPocketbaseBaseUrl } from "~/lib/pocketbase.server";

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

type ModelloDocumento = {
  id: string;
  nome: string;
  descrizione?: string;
  file?: string;
  attivo: boolean;
  fileUrl?: string | null;
};

const MODELLO_LETTERA_INCARICO = "Lettera incarico mediatore";

const SECTIONS = [
  { id: "modelli", label: "Modelli", icon: FolderOpen },
  { id: "tipi", label: "Tipi documento", icon: FileText },
  { id: "valore", label: "Scaglioni", icon: Scale },
  { id: "modalita", label: "Modalità", icon: Video },
  { id: "altro", label: "Altre opzioni", icon: ListChecks },
] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const baseUrl = getPocketbaseBaseUrl();

  const [tipi, scaglioni, modalita, competenze, motivazioneDeposito, modalitaConvocazione, materia, modelliRaw] =
    await Promise.all([
      pb.collection("documenti_tipi").getFullList<DocumentoTipo>({ sort: "nome" }).catch(() => [] as DocumentoTipo[]),
      pb.collection("scaglioni_mediazione").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("modalita_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("competenza_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("motivazione_deposito_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("modalita_convocazione_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("materia_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb
        .collection("modelli_documenti")
        .getFullList<ModelloDocumento>({ sort: "nome" })
        .catch(() => [] as ModelloDocumento[]),
    ]);

  let fileToken = "";
  try {
    fileToken = await pb.files.getToken();
  } catch {
    fileToken = "";
  }

  const modelli = modelliRaw.map((m) => {
    const fileUrl =
      m.file && fileToken
        ? pb.files.getUrl(m as never, m.file, { token: fileToken })
        : m.file
          ? `${baseUrl}/api/files/modelli_documenti/${m.id}/${m.file}`
          : null;
    return { ...m, fileUrl };
  });

  return json({
    tipi,
    scaglioni,
    modalita,
    competenze,
    motivazioneDeposito,
    modalitaConvocazione,
    materia,
    modelli,
    modelloLetteraNome: MODELLO_LETTERA_INCARICO,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const section = String(formData.get("_section") ?? "modelli");

  const go = () => redirect(`/admin/settings?section=${encodeURIComponent(section)}&saved=1`);

  if (intent === "add_tipo") {
    const nome = String(formData.get("nome") ?? "").trim();
    const descrizione = String(formData.get("descrizione") ?? "").trim() || undefined;
    if (!nome) return go();
    await pb.collection("documenti_tipi").create({ nome, descrizione, attivo: true });
  } else if (intent === "toggle_tipo") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("documenti_tipi").update(id, { attivo: !current });
  } else if (intent === "add_scaglione") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return go();
    await pb.collection("scaglioni_mediazione").create({ nome, attivo: true });
  } else if (intent === "toggle_scaglione") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("scaglioni_mediazione").update(id, { attivo: !current });
  } else if (intent === "add_modalita") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return go();
    await pb.collection("modalita_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_modalita") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("modalita_opzioni").update(id, { attivo: !current });
  } else if (intent === "add_competenza") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return go();
    await pb.collection("competenza_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_competenza") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("competenza_opzioni").update(id, { attivo: !current });
  } else if (intent === "add_motivazione_deposito") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return go();
    await pb.collection("motivazione_deposito_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_motivazione_deposito") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("motivazione_deposito_opzioni").update(id, { attivo: !current });
  } else if (intent === "add_modalita_convocazione") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return go();
    await pb.collection("modalita_convocazione_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_modalita_convocazione") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("modalita_convocazione_opzioni").update(id, { attivo: !current });
  } else if (intent === "add_materia") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return go();
    await pb.collection("materia_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_materia") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("materia_opzioni").update(id, { attivo: !current });
  } else if (intent === "upsert_modello") {
    const id = String(formData.get("id") ?? "").trim();
    const nome = String(formData.get("nome") ?? "").trim();
    const descrizione = String(formData.get("descrizione") ?? "").trim();
    const file = formData.get("file");
    const hasFile = isUploadedFile(file);
    if (!nome) return go();

    const pbForm = new FormData();
    pbForm.append("nome", nome);
    pbForm.append("descrizione", descrizione);
    pbForm.append("attivo", "true");
    if (hasFile) pbForm.append("file", file);

    if (id) {
      if (!hasFile) {
        await pb.collection("modelli_documenti").update(id, {
          nome,
          descrizione,
          attivo: true,
        });
      } else {
        await pb.collection("modelli_documenti").update(id, pbForm);
      }
    } else {
      if (!hasFile) return go();
      await pb.collection("modelli_documenti").create(pbForm);
    }
  } else if (intent === "toggle_modello") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("modelli_documenti").update(id, { attivo: !current });
  } else if (intent === "delete_modello") {
    const id = String(formData.get("id") ?? "");
    if (id) await pb.collection("modelli_documenti").delete(id);
  }

  return go();
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-base-200 px-1.5 text-[10px] font-semibold text-base-content/70">
      {n}
    </span>
  );
}

function OpzioneSection({
  title,
  description,
  addAction,
  toggleAction,
  items,
  nomePlaceholder,
  showDescrizione = false,
  section,
  icon: Icon,
}: {
  title: string;
  description: string;
  addAction: string;
  toggleAction: string;
  items: Opzione[];
  nomePlaceholder: string;
  showDescrizione?: boolean;
  section: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  const attivi = items.filter((i) => i.attivo).length;
  return (
    <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
      <div className="border-b border-base-200 px-5 py-4 flex items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#3aaeba]/12 text-[#2a8f99]">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-base-content">{title}</h2>
            <span className="text-[11px] text-base-content/50">
              {attivi}/{items.length} attivi
            </span>
          </div>
          <p className="mt-0.5 text-sm text-base-content/65">{description}</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <Form
          method="post"
          className={`grid gap-3 items-end ${
            showDescrizione
              ? "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
              : "md:grid-cols-[minmax(0,1fr)_auto]"
          }`}
        >
          <input type="hidden" name="_action" value={addAction} />
          <input type="hidden" name="_section" value={section} />
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
          <button
            type="submit"
            className="btn btn-sm border-0 bg-[#3aaeba] hover:bg-[#349aa5] text-white gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Aggiungi
          </button>
        </Form>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-base-300 bg-base-200/30 px-4 py-8 text-center text-sm text-base-content/55">
            Nessuna voce definita. Aggiungine una sopra.
          </div>
        ) : (
          <ul className="divide-y divide-base-200 rounded-xl border border-base-200 overflow-hidden">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 px-4 py-3 bg-base-100 hover:bg-base-200/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-base-content truncate">{item.nome}</p>
                  {showDescrizione && item.descrizione && (
                    <p className="text-xs text-base-content/55 truncate">{item.descrizione}</p>
                  )}
                </div>
                <Form method="post">
                  <input type="hidden" name="_action" value={toggleAction} />
                  <input type="hidden" name="_section" value={section} />
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="current" value={String(item.attivo)} />
                  <button
                    type="submit"
                    title={item.attivo ? "Disattiva" : "Attiva"}
                    className={
                      item.attivo
                        ? "badge badge-success badge-sm gap-1 cursor-pointer border-0"
                        : "badge badge-ghost badge-sm gap-1 cursor-pointer"
                    }
                  >
                    {item.attivo ? "Attivo" : "Off"}
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function AdminSettingsIndex() {
  const {
    tipi,
    scaglioni,
    modalita,
    competenze,
    motivazioneDeposito,
    modalitaConvocazione,
    materia,
    modelli,
    modelloLetteraNome,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get("section") || "modelli";
  const justSaved = searchParams.get("saved") === "1";

  const letteraModello = modelli.find((m) => m.nome === modelloLetteraNome) ?? null;
  const altriModelli = modelli.filter((m) => m.nome !== modelloLetteraNome);

  const setSection = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("section", id);
    next.delete("saved");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-base-content tracking-tight">
            Impostazioni applicazione
          </h1>
          <p className="mt-1 text-sm text-base-content/65">
            Modelli documenti, tipi e opzioni dei campi delle mediazioni.
          </p>
        </div>
        {justSaved && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Salvato
          </div>
        )}
      </header>

      <nav className="flex flex-wrap gap-1.5 rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-sm sticky top-2 z-20">
        {SECTIONS.map((s) => {
          const active = section === s.id;
          const Icon = s.icon;
          let count = 0;
          if (s.id === "modelli") count = modelli.length;
          if (s.id === "tipi") count = tipi.length;
          if (s.id === "valore") count = scaglioni.length;
          if (s.id === "modalita") count = modalita.length + modalitaConvocazione.length;
          if (s.id === "altro") count = motivazioneDeposito.length + materia.length + competenze.length;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={
                active
                  ? "inline-flex items-center gap-1.5 rounded-xl bg-[#3aaeba] px-3 py-2 text-sm font-medium text-white shadow-sm"
                  : "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-base-content/70 hover:bg-base-200"
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {s.label}
              <CountBadge n={count} />
            </button>
          );
        })}
      </nav>

      {section === "modelli" && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
            <div className="border-b border-base-200 bg-gradient-to-r from-[#3aaeba]/10 to-transparent px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3aaeba]/15 text-[#2a8f99]">
                    <Upload className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-semibold text-base-content">{modelloLetteraNome}</h2>
                    <p className="mt-0.5 text-sm text-base-content/65 max-w-2xl">
                      Modello .docx compilato (placeholder &lt;campo&gt; / &lt;&lt;campo&gt;&gt;) e allegato
                      in PDF a ogni mediazione quando viene assegnata o riassegnata a un mediatore.
                    </p>
                  </div>
                </div>
                {letteraModello ? (
                  <span
                    className={
                      letteraModello.attivo
                        ? "badge badge-success border-0"
                        : "badge badge-ghost"
                    }
                  >
                    {letteraModello.attivo ? "Pronto" : "Disattivo"}
                  </span>
                ) : (
                  <span className="badge badge-warning border-0">Da caricare</span>
                )}
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-base-200/40 border border-base-200 px-4 py-3">
                <p className="text-xs font-medium text-base-content/70 mb-1.5">Placeholder nel file</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "<Dott_sa>",
                    "<nome_mediatore>",
                    "<RGM>",
                    "<il_sottoscritto_la_sottoscritta>",
                    "<lo_la>",
                    "<designato_a>",
                    "<FIRMA_MEDIATORE>",
                    "<<RGM>>",
                  ].map((p) => (
                    <code
                      key={p}
                      className="rounded-md bg-base-100 border border-base-300 px-1.5 py-0.5 text-[11px] text-base-content/80"
                    >
                      {p}
                    </code>
                  ))}
                </div>
              </div>

              <Form
                method="post"
                encType="multipart/form-data"
                className="flex flex-col sm:flex-row sm:items-end gap-3"
              >
                <input type="hidden" name="_action" value="upsert_modello" />
                <input type="hidden" name="_section" value="modelli" />
                <input type="hidden" name="nome" value={modelloLetteraNome} />
                {letteraModello && <input type="hidden" name="id" value={letteraModello.id} />}
                <input
                  type="hidden"
                  name="descrizione"
                  value="Modello lettera di incarico generata all'assegnazione"
                />
                <div className="flex-1 min-w-0">
                  <label className="label py-0 mb-1">
                    <span className="label-text text-xs font-medium">
                      File .docx {letteraModello ? "(sostituisci)" : "*"}
                    </span>
                  </label>
                  <input
                    name="file"
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    required={!letteraModello}
                    className="file-input file-input-bordered file-input-sm w-full"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {letteraModello?.fileUrl && (
                    <a
                      href={letteraModello.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-sm btn-ghost gap-1"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Scarica
                    </a>
                  )}
                  <button
                    type="submit"
                    className="btn btn-sm border-0 bg-[#3aaeba] hover:bg-[#349aa5] text-white gap-1"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {letteraModello ? "Aggiorna" : "Carica"}
                  </button>
                </div>
              </Form>

              {letteraModello && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-base-content/60">
                  <Form method="post">
                    <input type="hidden" name="_action" value="toggle_modello" />
                    <input type="hidden" name="_section" value="modelli" />
                    <input type="hidden" name="id" value={letteraModello.id} />
                    <input type="hidden" name="current" value={String(letteraModello.attivo)} />
                    <button type="submit" className="link link-hover text-xs">
                      {letteraModello.attivo ? "Disattiva modello" : "Riattiva modello"}
                    </button>
                  </Form>
                  {letteraModello.file && <span>File: {letteraModello.file}</span>}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
            <div className="border-b border-base-200 px-5 py-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-base-200 text-base-content/70">
                <FolderOpen className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-semibold text-base-content">Altri modelli</h2>
                <p className="text-sm text-base-content/65">
                  Template aggiuntivi (verbali, note, ecc.) per uso futuro.
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <Form
                method="post"
                encType="multipart/form-data"
                className="grid gap-3 items-end md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_auto]"
              >
                <input type="hidden" name="_action" value="upsert_modello" />
                <input type="hidden" name="_section" value="modelli" />
                <div>
                  <label className="label py-0">
                    <span className="label-text text-xs font-medium">Nome *</span>
                  </label>
                  <input
                    name="nome"
                    required
                    className="input input-sm input-bordered w-full"
                    placeholder="es. Verbale modello"
                  />
                </div>
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
                <div>
                  <label className="label py-0">
                    <span className="label-text text-xs font-medium">File *</span>
                  </label>
                  <input
                    name="file"
                    type="file"
                    required
                    accept=".docx,.pdf,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="file-input file-input-sm file-input-bordered w-full"
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-sm border-0 bg-[#3aaeba] hover:bg-[#349aa5] text-white gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Aggiungi
                </button>
              </Form>

              {altriModelli.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base-300 bg-base-200/30 px-4 py-8 text-center text-sm text-base-content/55">
                  Nessun altro modello caricato.
                </div>
              ) : (
                <ul className="divide-y divide-base-200 rounded-xl border border-base-200 overflow-hidden">
                  {altriModelli.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-base-200/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{m.nome}</p>
                        <p className="text-xs text-base-content/55 truncate">
                          {m.descrizione || m.file || "—"}
                        </p>
                      </div>
                      {m.fileUrl && (
                        <a
                          href={m.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost btn-xs gap-1"
                        >
                          <Download className="h-3 w-3" />
                          Apri
                        </a>
                      )}
                      <Form method="post">
                        <input type="hidden" name="_action" value="toggle_modello" />
                        <input type="hidden" name="_section" value="modelli" />
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="current" value={String(m.attivo)} />
                        <button
                          type="submit"
                          className={
                            m.attivo
                              ? "badge badge-success badge-sm border-0 cursor-pointer"
                              : "badge badge-ghost badge-sm cursor-pointer"
                          }
                        >
                          {m.attivo ? "Attivo" : "Off"}
                        </button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="_action" value="delete_modello" />
                        <input type="hidden" name="_section" value="modelli" />
                        <input type="hidden" name="id" value={m.id} />
                        <button
                          type="submit"
                          className="btn btn-ghost btn-xs text-error"
                          title="Elimina"
                          onClick={(e) => {
                            if (!confirm("Eliminare questo modello?")) e.preventDefault();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}

      {section === "tipi" && (
        <OpzioneSection
          title="Tipi di documento"
          description="Disponibili nel menu quando carichi documenti nelle mediazioni."
          addAction="add_tipo"
          toggleAction="toggle_tipo"
          items={tipi}
          nomePlaceholder="es. Richiesta, Verbale, Consegna verbale"
          showDescrizione
          section="tipi"
          icon={FileText}
        />
      )}

      {section === "valore" && (
        <OpzioneSection
          title="Scaglioni di valore"
          description="Opzioni per il campo Valore nelle mediazioni."
          addAction="add_scaglione"
          toggleAction="toggle_scaglione"
          items={scaglioni}
          nomePlaceholder="es. da € 1.001 a € 5.000"
          section="valore"
          icon={Scale}
        />
      )}

      {section === "modalita" && (
        <div className="space-y-5">
          <OpzioneSection
            title="Modalità di mediazione"
            description="Opzioni per il campo Modalità nelle mediazioni."
            addAction="add_modalita"
            toggleAction="toggle_modalita"
            items={modalita}
            nomePlaceholder="es. Modalità telematica, In presenza"
            section="modalita"
            icon={Video}
          />
          <OpzioneSection
            title="Modalità convocazione"
            description="Opzioni per l'invio della convocazione (PEC, raccomandata)."
            addAction="add_modalita_convocazione"
            toggleAction="toggle_modalita_convocazione"
            items={modalitaConvocazione}
            nomePlaceholder="es. Pec alla parte"
            section="modalita"
            icon={Video}
          />
        </div>
      )}

      {section === "altro" && (
        <div className="space-y-5">
          <OpzioneSection
            title="Motivazione deposito"
            description="Opzioni per il campo Motivazione deposito (Istanza depositata)."
            addAction="add_motivazione_deposito"
            toggleAction="toggle_motivazione_deposito"
            items={motivazioneDeposito}
            nomePlaceholder="es. Quale condizione di procedibilità"
            section="altro"
            icon={ListChecks}
          />
          <OpzioneSection
            title="Materia / Oggetto controversia"
            description="Opzioni per il campo Oggetto (materia della controversia)."
            addAction="add_materia"
            toggleAction="toggle_materia"
            items={materia}
            nomePlaceholder="es. Condominio, Locazione, Altro"
            section="altro"
            icon={ListChecks}
          />
          <OpzioneSection
            title="Competenze territoriali"
            description="Opzioni per il campo Competenza nelle mediazioni."
            addAction="add_competenza"
            toggleAction="toggle_competenza"
            items={competenze}
            nomePlaceholder="es. Roma, Milano, Napoli"
            section="altro"
            icon={MapPin}
          />
        </div>
      )}
    </div>
  );
}
