import { Form, useLoaderData, useSearchParams } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useState, type ComponentType } from "react";
import {
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  Info,
  ListChecks,
  Mail,
  MapPin,
  Plus,
  Scale,
  Send,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { requireUserAndRole } from "~/lib/auth.server";
import { isUploadedFile } from "~/lib/form-data.server";
import {
  MODELLO_LETTERA_INCARICO_NOME,
  MODELLI_NOTIFICHE_FISSI,
  MODELLI_NOTIFICHE_NOMI,
} from "~/lib/modelli-notifiche";
import {
  MODELLI_VERBALI_FISSI,
  MODELLI_VERBALI_NOMI,
  VERBALE_MERGE_FIELDS,
} from "~/lib/modelli-verbali";
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

const SECTION_IDS = ["modelli", "tipi", "campi", "convocazioni"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const SECTIONS = [
  { id: "modelli", label: "Modelli", icon: FolderOpen },
  { id: "tipi", label: "Tipi documento", icon: FileText },
  { id: "campi", label: "Campi mediazione", icon: ListChecks },
  { id: "convocazioni", label: "Convocazioni", icon: Send },
] as const;

const SECTION_ALIASES: Record<string, SectionId> = {
  valore: "campi",
  modalita: "campi",
  altro: "campi",
  campi: "campi",
  tipi: "tipi",
  modelli: "modelli",
  convocazioni: "convocazioni",
};

const MODELLO_SUBSECTIONS = [
  { id: "incarico", label: "Lettera incarico" },
  { id: "notifiche", label: "Notifiche" },
  { id: "verbali", label: "Verbali" },
  { id: "altri", label: "Altri" },
] as const;
type ModelloSubsectionId = (typeof MODELLO_SUBSECTIONS)[number]["id"];

function normalizeSection(raw: string): SectionId {
  return SECTION_ALIASES[raw] ?? "modelli";
}

function normalizeModelloSubsection(raw: string | null): ModelloSubsectionId {
  const id = MODELLO_SUBSECTIONS.find((s) => s.id === raw)?.id;
  return id ?? "incarico";
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const baseUrl = getPocketbaseBaseUrl();

  const [
    tipi,
    scaglioni,
    modalita,
    competenze,
    motivazioneDeposito,
    modalitaConvocazione,
    materia,
    motivoRaccomandata,
    modelliRaw,
  ] = await Promise.all([
      pb.collection("documenti_tipi").getFullList<DocumentoTipo>({ sort: "nome" }).catch(() => [] as DocumentoTipo[]),
      pb.collection("scaglioni_mediazione").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("modalita_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("competenza_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("motivazione_deposito_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("modalita_convocazione_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("materia_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
      pb.collection("motivo_raccomandata_opzioni").getFullList<Opzione>({ sort: "nome" }).catch(() => [] as Opzione[]),
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
    motivoRaccomandata,
    modelli,
    modelloLetteraNome: MODELLO_LETTERA_INCARICO_NOME,
    modelliNotifiche: MODELLI_NOTIFICHE_FISSI,
    modelliVerbali: MODELLI_VERBALI_FISSI,
    verbaleMergeFields: VERBALE_MERGE_FIELDS,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const section = normalizeSection(String(formData.get("_section") ?? "modelli"));
  const subsection = String(formData.get("_subsection") ?? "").trim();

  const go = () => {
    const params = new URLSearchParams({ section, saved: "1" });
    if (section === "modelli" && subsection) {
      params.set("subsection", normalizeModelloSubsection(subsection));
    }
    return redirect(`/admin/settings?${params.toString()}`);
  };

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
  } else if (intent === "add_motivo_raccomandata") {
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) return go();
    await pb.collection("motivo_raccomandata_opzioni").create({ nome, attivo: true });
  } else if (intent === "toggle_motivo_raccomandata") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("current") === "true";
    if (id) await pb.collection("motivo_raccomandata_opzioni").update(id, { attivo: !current });
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
  } else if (typeof intent === "string" && intent.startsWith("delete_")) {
    const collectionByDelete: Record<string, string> = {
      delete_tipo: "documenti_tipi",
      delete_scaglione: "scaglioni_mediazione",
      delete_modalita: "modalita_opzioni",
      delete_competenza: "competenza_opzioni",
      delete_motivazione_deposito: "motivazione_deposito_opzioni",
      delete_modalita_convocazione: "modalita_convocazione_opzioni",
      delete_materia: "materia_opzioni",
      delete_motivo_raccomandata: "motivo_raccomandata_opzioni",
    };
    const collection = collectionByDelete[intent];
    const id = String(formData.get("id") ?? "");
    if (collection && id) {
      try {
        await pb.collection(collection).delete(id);
      } catch {
        // Ignora: record già assente o vincoli di relazione
      }
    }
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
  const deleteAction = toggleAction.replace(/^toggle_/, "delete_");
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
                <Form method="post">
                  <input type="hidden" name="_action" value={deleteAction} />
                  <input type="hidden" name="_section" value={section} />
                  <input type="hidden" name="id" value={item.id} />
                  <button
                    type="submit"
                    className="btn btn-ghost btn-xs text-error"
                    title="Elimina"
                    onClick={(e) => {
                      if (!confirm(`Eliminare «${item.nome}»?`)) e.preventDefault();
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
  );
}

function FixedModelloCard({
  nome,
  descrizione,
  record,
  placeholders,
  fileDescription,
  accent = false,
  compact = false,
  subsection = "incarico",
}: {
  nome: string;
  descrizione: string;
  record: ModelloDocumento | null;
  placeholders?: string[];
  fileDescription: string;
  accent?: boolean;
  compact?: boolean;
  subsection?: ModelloSubsectionId;
}) {
  return (
    <section
      className={
        compact
          ? "rounded-xl border border-base-200 bg-base-100 overflow-hidden"
          : "rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden"
      }
    >
      <div
        className={
          accent
            ? "border-b border-base-200 bg-gradient-to-r from-[#3aaeba]/10 to-transparent px-5 py-4"
            : "border-b border-base-200 px-4 py-3"
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {!compact && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3aaeba]/15 text-[#2a8f99]">
                <Upload className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <h2 className={`font-semibold text-base-content ${compact ? "text-sm" : ""}`}>
                {nome}
              </h2>
              <p className="mt-0.5 text-sm text-base-content/65 max-w-2xl">{descrizione}</p>
            </div>
          </div>
          {record ? (
            <span
              className={
                record.attivo ? "badge badge-success border-0" : "badge badge-ghost"
              }
            >
              {record.attivo ? "Pronto" : "Disattivo"}
            </span>
          ) : (
            <span className="badge badge-warning border-0">Da caricare</span>
          )}
        </div>
      </div>

      <div className={`space-y-3 ${compact ? "p-4" : "p-5 space-y-4"}`}>
        {placeholders && placeholders.length > 0 && (
          <div className="rounded-xl bg-base-200/40 border border-base-200 px-4 py-3">
            <p className="text-xs font-medium text-base-content/70 mb-1.5">Placeholder nel file</p>
            <div className="flex flex-wrap gap-1.5">
              {placeholders.map((p) => (
                <code
                  key={p}
                  className="rounded-md bg-base-100 border border-base-300 px-1.5 py-0.5 text-[11px] text-base-content/80"
                >
                  {p}
                </code>
              ))}
            </div>
          </div>
        )}

        <Form
          method="post"
          encType="multipart/form-data"
          className="flex flex-col sm:flex-row sm:items-end gap-3"
        >
          <input type="hidden" name="_action" value="upsert_modello" />
          <input type="hidden" name="_section" value="modelli" />
          <input type="hidden" name="_subsection" value={subsection} />
          <input type="hidden" name="nome" value={nome} />
          {record && <input type="hidden" name="id" value={record.id} />}
          <input type="hidden" name="descrizione" value={fileDescription} />
          <div className="flex-1 min-w-0">
            <label className="label py-0 mb-1">
              <span className="label-text text-xs font-medium">
                File .docx {record ? "(sostituisci)" : "*"}
              </span>
            </label>
            <input
              name="file"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              required={!record}
              className="file-input file-input-bordered file-input-sm w-full"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {record?.fileUrl && (
              <a
                href={record.fileUrl}
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
              {record ? "Aggiorna" : "Carica"}
            </button>
          </div>
        </Form>

        {record && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-base-content/60">
            <Form method="post">
              <input type="hidden" name="_action" value="toggle_modello" />
              <input type="hidden" name="_section" value="modelli" />
              <input type="hidden" name="_subsection" value={subsection} />
              <input type="hidden" name="id" value={record.id} />
              <input type="hidden" name="current" value={String(record.attivo)} />
              <button type="submit" className="link link-hover text-xs">
                {record.attivo ? "Disattiva modello" : "Riattiva modello"}
              </button>
            </Form>
            {record.file && <span>File: {record.file}</span>}
            <Form method="post">
              <input type="hidden" name="_action" value="delete_modello" />
              <input type="hidden" name="_section" value="modelli" />
              <input type="hidden" name="_subsection" value={subsection} />
              <input type="hidden" name="id" value={record.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-1 text-xs text-error link link-hover"
                onClick={(e) => {
                  if (
                    !confirm(
                      `Eliminare il file di «${nome}»? Potrai caricarne uno nuovo in seguito.`,
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Elimina file
              </button>
            </Form>
          </div>
        )}
      </div>
    </section>
  );
}

function VerbalePlaceholdersInfo({
  open,
  onClose,
  fields,
}: {
  open: boolean;
  onClose: () => void;
  fields: readonly { name: string; source: string; note: string }[];
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Chiudi"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-base-200 px-5 py-4">
          <div>
            <h3 className="font-semibold text-base-content">Placeholder verbali</h3>
            <p className="mt-1 text-sm text-base-content/65">
              Nel file Word inserisci i placeholder con delimitatore{" "}
              <code className="rounded bg-base-200 px-1">#</code>, es.{" "}
              <code className="rounded bg-base-200 px-1">#RGM#</code>. Cerca{" "}
              <code className="rounded bg-base-200 px-1">#</code> nel documento per trovarli tutti.
              In generazione vengono sostituiti con i dati della mediazione.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={onClose}
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Placeholder</th>
                <th>Sorgente DB</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.name}>
                  <td>
                    <code className="rounded bg-base-200 px-1.5 py-0.5 text-xs">#{f.name}#</code>
                  </td>
                  <td className="text-xs text-base-content/80">{f.source}</td>
                  <td className="text-xs text-base-content/65">{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
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
    motivoRaccomandata,
    modelli,
    modelloLetteraNome,
    modelliNotifiche,
    modelliVerbali,
    verbaleMergeFields,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = normalizeSection(searchParams.get("section") || "modelli");
  const subsection = normalizeModelloSubsection(searchParams.get("subsection"));
  const justSaved = searchParams.get("saved") === "1";
  const [verbaleInfoOpen, setVerbaleInfoOpen] = useState(false);

  const letteraModello = modelli.find((m) => m.nome === modelloLetteraNome) ?? null;
  const fixedNomi = new Set<string>([
    modelloLetteraNome,
    ...MODELLI_NOTIFICHE_NOMI,
    ...MODELLI_VERBALI_NOMI,
  ]);
  const altriModelli = modelli.filter((m) => !fixedNomi.has(m.nome));
  const modelliNotificheCards = modelliNotifiche.map((meta) => ({
    ...meta,
    record: modelli.find((m) => m.nome === meta.nome) ?? null,
  }));
  const modelliVerbaliCards = modelliVerbali.map((meta) => ({
    ...meta,
    record: modelli.find((m) => m.nome === meta.nome) ?? null,
  }));

  const notifichePronti = modelliNotificheCards.filter((c) => c.record?.file).length;
  const verbaliPronti = modelliVerbaliCards.filter((c) => c.record?.file).length;
  const incaricoPronto = letteraModello?.file ? 1 : 0;

  const setSection = (id: SectionId) => {
    const next = new URLSearchParams();
    next.set("section", id);
    if (id === "modelli") next.set("subsection", "incarico");
    setSearchParams(next, { replace: true });
  };

  const setSubsection = (id: ModelloSubsectionId) => {
    const next = new URLSearchParams(searchParams);
    next.set("section", "modelli");
    next.set("subsection", id);
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
            Modelli, tipi documento e opzioni usate nelle mediazioni e nelle convocazioni.
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
          if (s.id === "modelli") {
            count =
              (letteraModello ? 1 : 0) +
              modelliNotifiche.length +
              modelliVerbali.length +
              altriModelli.length;
          }
          if (s.id === "tipi") count = tipi.length;
          if (s.id === "campi") {
            count =
              scaglioni.length +
              modalita.length +
              materia.length +
              competenze.length +
              motivazioneDeposito.length;
          }
          if (s.id === "convocazioni") {
            count = modalitaConvocazione.length + motivoRaccomandata.length;
          }
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
        <div className="space-y-4">
          <nav className="flex flex-wrap gap-1 rounded-xl border border-base-200 bg-base-200/40 p-1">
            {MODELLO_SUBSECTIONS.map((s) => {
              const active = subsection === s.id;
              let badge = "";
              if (s.id === "incarico") badge = `${incaricoPronto}/1`;
              if (s.id === "notifiche") {
                badge = `${notifichePronti}/${modelliNotificheCards.length}`;
              }
              if (s.id === "verbali") badge = `${verbaliPronti}/${modelliVerbaliCards.length}`;
              if (s.id === "altri") badge = String(altriModelli.length);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSubsection(s.id)}
                  className={
                    active
                      ? "inline-flex items-center gap-1.5 rounded-lg bg-base-100 px-3 py-1.5 text-sm font-medium text-base-content shadow-sm"
                      : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-base-content/65 hover:bg-base-100/70"
                  }
                >
                  {s.label}
                  <span className="text-[10px] font-semibold text-base-content/50">{badge}</span>
                </button>
              );
            })}
          </nav>

          {subsection === "incarico" && (
            <FixedModelloCard
              nome={modelloLetteraNome}
              descrizione="Modello .docx compilato (placeholder &lt;campo&gt; / &lt;&lt;campo&gt;&gt;) e allegato in PDF a ogni mediazione quando viene assegnata o riassegnata a un mediatore."
              record={letteraModello}
              placeholders={[
                "<Dott_sa>",
                "<nome_mediatore>",
                "<RGM>",
                "<il_sottoscritto_la_sottoscritta>",
                "<lo_la>",
                "<designato_a>",
                "<FIRMA_MEDIATORE>",
                "<<RGM>>",
              ]}
              fileDescription="Modello lettera di incarico generata all'assegnazione"
              accent
              subsection="incarico"
            />
          )}

          {subsection === "notifiche" && (
            <div className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
              <div className="border-b border-base-200 px-5 py-4">
                <h2 className="font-semibold text-base-content">Modelli notifiche (flusso)</h2>
                <p className="mt-0.5 text-sm text-base-content/65">
                  Convocazioni e modulo di adesione usati dall&apos;export Flusso su Da convocare.
                  Selezione automatica: competenza territoriale attiva → art. 4; fuori lista →
                  accordo organismi (PF/PG).
                </p>
              </div>
              <div className="p-5 space-y-4">
                {modelliNotificheCards.map((card) => (
                  <FixedModelloCard
                    key={card.nome}
                    nome={card.nome}
                    descrizione={card.descrizione}
                    record={card.record}
                    fileDescription={card.descrizione}
                    compact
                    subsection="notifiche"
                  />
                ))}
              </div>
            </div>
          )}

          {subsection === "verbali" && (
            <>
              <div className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
                <div className="border-b border-base-200 px-5 py-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-base-content">Modelli verbali</h2>
                    <p className="mt-0.5 text-sm text-base-content/65">
                      Un modello .docx (stampa unione) per ogni esito finale. Dalla scheda mediazione
                      si genera e scarica il Word compilato. Sostituisci il file per aggiornare il
                      testo.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost gap-1.5 border border-base-300"
                    onClick={() => setVerbaleInfoOpen(true)}
                  >
                    <Info className="h-3.5 w-3.5" />
                    Placeholder Word
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  {modelliVerbaliCards.map((card) => (
                    <FixedModelloCard
                      key={card.nome}
                      nome={card.nome}
                      descrizione={`${card.descrizione} Esito: ${card.esito}.`}
                      record={card.record}
                      fileDescription={card.descrizione}
                      compact
                      subsection="verbali"
                    />
                  ))}
                </div>
              </div>
              <VerbalePlaceholdersInfo
                open={verbaleInfoOpen}
                onClose={() => setVerbaleInfoOpen(false)}
                fields={verbaleMergeFields}
              />
            </>
          )}

          {subsection === "altri" && (
            <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">
              <div className="border-b border-base-200 px-5 py-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-base-200 text-base-content/70">
                  <FolderOpen className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-semibold text-base-content">Altri modelli</h2>
                  <p className="text-sm text-base-content/65">
                    Template aggiuntivi generici (note, allegati, ecc.).
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
                  <input type="hidden" name="_subsection" value="altri" />
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
                          <input type="hidden" name="_subsection" value="altri" />
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
                          <input type="hidden" name="_subsection" value="altri" />
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
          )}
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

      {section === "campi" && (
        <div className="space-y-5">
          <OpzioneSection
            title="Scaglioni di valore"
            description="Opzioni per il campo Valore nelle mediazioni."
            addAction="add_scaglione"
            toggleAction="toggle_scaglione"
            items={scaglioni}
            nomePlaceholder="es. da € 1.001 a € 5.000"
            section="campi"
            icon={Scale}
          />
          <OpzioneSection
            title="Modalità di mediazione"
            description="Opzioni per il campo Modalità nelle mediazioni."
            addAction="add_modalita"
            toggleAction="toggle_modalita"
            items={modalita}
            nomePlaceholder="es. Modalità telematica, In presenza"
            section="campi"
            icon={Video}
          />
          <OpzioneSection
            title="Materia / Oggetto controversia"
            description="Opzioni per il campo Oggetto (materia della controversia)."
            addAction="add_materia"
            toggleAction="toggle_materia"
            items={materia}
            nomePlaceholder="es. Condominio, Locazione, Altro"
            section="campi"
            icon={ListChecks}
          />
          <OpzioneSection
            title="Competenze territoriali"
            description="Opzioni per il campo Competenza nelle mediazioni."
            addAction="add_competenza"
            toggleAction="toggle_competenza"
            items={competenze}
            nomePlaceholder="es. Roma, Milano, Napoli"
            section="campi"
            icon={MapPin}
          />
          <OpzioneSection
            title="Motivazione deposito"
            description="Opzioni per il campo Motivazione deposito (Istanza depositata)."
            addAction="add_motivazione_deposito"
            toggleAction="toggle_motivazione_deposito"
            items={motivazioneDeposito}
            nomePlaceholder="es. Quale condizione di procedibilità"
            section="campi"
            icon={ListChecks}
          />
        </div>
      )}

      {section === "convocazioni" && (
        <div className="space-y-5">
          <OpzioneSection
            title="Modalità convocazione"
            description="Opzioni per l'invio della convocazione (PEC, raccomandata)."
            addAction="add_modalita_convocazione"
            toggleAction="toggle_modalita_convocazione"
            items={modalitaConvocazione}
            nomePlaceholder="es. Pec alla parte"
            section="convocazioni"
            icon={Send}
          />
          <OpzioneSection
            title="Motivi raccomandata non consegnabile"
            description="Motivi selezionabili quando lo stato raccomandata è «Non consegnabile»."
            addAction="add_motivo_raccomandata"
            toggleAction="toggle_motivo_raccomandata"
            items={motivoRaccomandata}
            nomePlaceholder="es. Destinatario irreperibile, Indirizzo inesatto"
            section="convocazioni"
            icon={Mail}
          />
        </div>
      )}
    </div>
  );
}
