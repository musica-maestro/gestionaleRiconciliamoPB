import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { ESITO_FINALE_VALUES, normalizeEsitoFinale } from "~/lib/esito-finale";

function pocketBaseErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && data !== null) {
      const msg = (data as Record<string, unknown>).message;
      if (typeof msg === "string" && msg.trim()) return msg;
      const nested = (data as Record<string, unknown>).data;
      if (nested && typeof nested === "object" && nested !== null) {
        const parts: string[] = [];
        for (const [field, info] of Object.entries(nested as Record<string, unknown>)) {
          if (info && typeof info === "object" && "message" in info) {
            const m = String((info as { message?: string }).message ?? "").trim();
            if (m) parts.push(`${field}: ${m}`);
          }
        }
        if (parts.length) return parts.join("; ");
      }
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Errore durante la creazione";
}

type SoggettoOption = { id: string; display: string; tipo: string };
type MediatoreOption = { id: string; name: string };

function soggettoDisplay(s: Record<string, unknown>): string {
  const tipo = String(s.tipo ?? "");
  if (tipo === "Giuridica") {
    return String(s.ragione_sociale ?? "").trim() || (s.id as string);
  }
  const nome = [s.nome, s.cognome].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
  return nome || String(s.codice_fiscale ?? "").trim() || (s.id as string);
}

function proposeNextRgm(existing: string[]): string {
  const year = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
  }).format(new Date());
  const re = /^(\d+)-(\d{4})$/;
  let maxN = 0;
  for (const raw of existing) {
    const m = re.exec(String(raw ?? "").trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isNaN(n) && n > maxN) maxN = n;
  }
  return `${maxN + 1}-${year}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  try {
    const { pb } = await createPB(request);
    const [materiaResp, modalitaResp, soggettiResp, mediatoriResp, rgmResp] = await Promise.all([
      pb.collection("materia_opzioni").getFullList({
        filter: "attivo = true",
        sort: "nome",
      }).catch(() => []),
      pb.collection("modalita_opzioni").getFullList({
        filter: "attivo = true",
        sort: "nome",
      }).catch(() => []),
      pb.collection("soggetti").getFullList({
        sort: "ragione_sociale,cognome,nome",
        fields: "id,tipo,nome,cognome,ragione_sociale,codice_fiscale",
        requestKey: null,
      }).catch(() => []),
      pb.collection("users").getFullList({
        filter: 'ruolo_corrente = "mediatore" || ruoli ?~ "mediatore"',
        sort: "name,email",
        fields: "id,name,email,stato",
        requestKey: null,
      }).catch(() => []),
      pb.collection("mediazioni").getFullList({
        filter: 'rgm != "" && rgm != null',
        fields: "rgm",
        requestKey: null,
      }).catch(() => []),
    ]);
    const soggetti: SoggettoOption[] = (soggettiResp as Record<string, unknown>[]).map((s) => ({
      id: String(s.id),
      display: soggettoDisplay(s),
      tipo: String(s.tipo ?? ""),
    }));
    const mediatori: MediatoreOption[] = (mediatoriResp as Record<string, unknown>[])
      .filter((u) => {
        const stato = String(u.stato ?? "").toLowerCase();
        return stato !== "false" && stato !== "inattivo";
      })
      .map((u) => ({
        id: String(u.id),
        name: String(u.name || u.email || u.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const proposedRgm = proposeNextRgm(
      (rgmResp as { rgm?: string }[]).map((r) => String(r.rgm ?? "")),
    );
    return json({
      materiaOpzioni: materiaResp.map((r) => (r.nome as string) ?? "").filter(Boolean),
      modalitaOpzioni: modalitaResp.map((r) => (r.nome as string) ?? "").filter(Boolean),
      soggetti,
      mediatori,
      proposedRgm,
      loaderError: null as string | null,
    });
  } catch (err: unknown) {
    return json({
      materiaOpzioni: [] as string[],
      modalitaOpzioni: [] as string[],
      soggetti: [] as SoggettoOption[],
      mediatori: [] as MediatoreOption[],
      proposedRgm: "",
      loaderError: pocketBaseErrorMessage(err) || "Impossibile contattare PocketBase",
    });
  }
}

type DraftParteMode = "existing" | "new";
type DraftParteRuolo = "Istante" | "Chiamato";
type DraftParteTipo = "Fisica" | "Giuridica";

type DraftParte = {
  key: string;
  ruolo: DraftParteRuolo;
  mode: DraftParteMode;
  soggettoId: string;
  tipo: DraftParteTipo;
  nome: string;
  cognome: string;
  ragione_sociale: string;
  codice_fiscale: string;
  email: string;
  pec: string;
  indirizzo_riga_1: string;
  numero_civico: string;
  comune: string;
  provincia: string;
  cap: string;
};

function emptyParte(ruolo: DraftParteRuolo): DraftParte {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ruolo,
    mode: "existing",
    soggettoId: "",
    tipo: "Fisica",
    nome: "",
    cognome: "",
    ragione_sociale: "",
    codice_fiscale: "",
    email: "",
    pec: "",
    indirizzo_riga_1: "",
    numero_civico: "",
    comune: "",
    provincia: "",
    cap: "",
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUserAndRole(request, "admin", "manager");
  const { pb } = await createPB(request);

  const formData = await request.formData();
  if (String(formData.get("_intent") ?? "") !== "create") {
    return json({ error: "Completa il walkthrough fino alla conferma." }, 400);
  }
  const rgm = String(formData.get("rgm") ?? "").trim();
  const oggetto = String(formData.get("oggetto") ?? "").trim();
  const valore = String(formData.get("valore") ?? "").trim();
  const data_deposito = formData.get("data_deposito")
    ? String(formData.get("data_deposito"))
    : null;
  const data_protocollo = formData.get("data_protocollo")
    ? String(formData.get("data_protocollo"))
    : null;
  const data_avvio_entro = formData.get("data_avvio_entro")
    ? String(formData.get("data_avvio_entro"))
    : null;
  const modalita_mediazione = String(formData.get("modalita_mediazione") ?? "").trim() || undefined;
  const motivazione_deposito = String(formData.get("motivazione_deposito") ?? "").trim() || undefined;
  const modalita_convocazione = String(formData.get("modalita_convocazione") ?? "").trim() || undefined;
  const esitoRaw = String(formData.get("esito_finale") ?? "").trim();
  const esito_finale = esitoRaw ? normalizeEsitoFinale(esitoRaw) : undefined;
  const trasmessa = String(formData.get("trasmessa") ?? "") === "true";
  const proposta_mediatore = String(formData.get("proposta_mediatore") ?? "") === "true";
  const esoneratiRaw = String(formData.get("numero_esonerati_gratuito_patrocinio") ?? "").trim();
  const numero_esonerati_gratuito_patrocinio = esoneratiRaw === ""
    ? 0
    : Math.max(0, Math.floor(Number(esoneratiRaw)) || 0);
  const materia_altro = String(formData.get("materia_altro") ?? "").trim() || undefined;
  const mediatore = String(formData.get("mediatore") ?? "").trim() || undefined;

  let partiPayload: Array<Record<string, string>> = [];
  try {
    const raw = String(formData.get("parti_json") ?? "[]");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) partiPayload = parsed as Array<Record<string, string>>;
  } catch {
    return json({ error: "Dati parti non validi" }, 400);
  }

  const body: Record<string, unknown> = {
    rgm: rgm || undefined,
    oggetto: oggetto || undefined,
    valore: valore || undefined,
    data_deposito: data_deposito || undefined,
    data_protocollo: data_protocollo || undefined,
    data_avvio_entro: data_avvio_entro || undefined,
    modalita_mediazione: modalita_mediazione || undefined,
    motivazione_deposito: motivazione_deposito || undefined,
    modalita_convocazione: modalita_convocazione || undefined,
    esito_finale: esito_finale || undefined,
    trasmessa,
    proposta_mediatore,
    numero_esonerati_gratuito_patrocinio,
    materia_altro: oggetto.toLowerCase() === "altro" ? materia_altro : undefined,
    stato_adesione: "in_attesa",
    adesione: false,
    // With mediatore, Go hook applyAssignment → assegnata (+ RGM if empty)
    ...(mediatore
      ? { mediatore }
      : { stato: "registrata" }),
  };

  try {
    const record = await pb.collection("mediazioni").create(body);
    const mediazioneId = record.id;

    const seen = new Set<string>();
    for (const p of partiPayload) {
      const ruolo = String(p.ruolo ?? "").trim();
      if (ruolo !== "Istante" && ruolo !== "Chiamato") continue;

      let soggettoId = String(p.soggettoId ?? "").trim();
      if (!soggettoId) {
        const tipo = String(p.tipo ?? "Fisica").trim() === "Giuridica" ? "Giuridica" : "Fisica";
        const soggettoData: Record<string, unknown> = { tipo };
        if (tipo === "Fisica") {
          soggettoData.nome = String(p.nome ?? "").trim() || undefined;
          soggettoData.cognome = String(p.cognome ?? "").trim() || undefined;
          soggettoData.codice_fiscale = String(p.codice_fiscale ?? "").trim() || undefined;
          soggettoData.email = String(p.email ?? "").trim() || undefined;
        } else {
          soggettoData.ragione_sociale = String(p.ragione_sociale ?? "").trim() || undefined;
          soggettoData.codice_fiscale = String(p.codice_fiscale ?? "").trim() || undefined;
          soggettoData.pec = String(p.pec ?? "").trim() || undefined;
        }
        soggettoData.indirizzo_riga_1 = String(p.indirizzo_riga_1 ?? "").trim() || undefined;
        soggettoData.numero_civico = String(p.numero_civico ?? "").trim() || undefined;
        soggettoData.comune = String(p.comune ?? "").trim() || undefined;
        soggettoData.provincia = String(p.provincia ?? "").trim() || undefined;
        soggettoData.cap = String(p.cap ?? "").trim() || undefined;

        const hasIdentity =
          tipo === "Fisica"
            ? Boolean(soggettoData.nome || soggettoData.cognome || soggettoData.codice_fiscale)
            : Boolean(soggettoData.ragione_sociale || soggettoData.codice_fiscale);
        if (!hasIdentity) continue;

        const created = await pb.collection("soggetti").create(soggettoData);
        soggettoId = created.id;
      }

      const dupKey = `${soggettoId}:${ruolo}`;
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);

      await pb.collection("partecipazioni").create({
        mediazione: mediazioneId,
        soggetto: soggettoId,
        istante_o_chiamato: ruolo,
      });
    }

    return redirect(`/mediazioni/${mediazioneId}?tab=parti`);
  } catch (err: unknown) {
    return json({ error: pocketBaseErrorMessage(err) }, 400);
  }
}

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:ring-2 focus:ring-[#3aaeba] text-sm";
const labelClass = "block text-sm font-medium text-slate-700";

const STEPS = [
  { id: 1, title: "Dati mediazione", hint: "RGM, mediatore, materia" },
  { id: 2, title: "Parti", hint: "Istanti e chiamati" },
  { id: 3, title: "Conferma", hint: "Riepilogo e creazione" },
] as const;

export default function NewMediazione() {
  const { materiaOpzioni, modalitaOpzioni, soggetti, mediatori, proposedRgm, loaderError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [step, setStep] = useState(1);
  const [rgm, setRgm] = useState(proposedRgm);
  const [mediatoreId, setMediatoreId] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [parti, setParti] = useState<DraftParte[]>([emptyParte("Istante"), emptyParte("Chiamato")]);
  const [soggettoFilter, setSoggettoFilter] = useState("");

  const mediatoreName = mediatori.find((m) => m.id === mediatoreId)?.name ?? "";

  const modalitaOptions =
    modalitaOpzioni.length > 0
      ? modalitaOpzioni
      : ["Telematica", "Presenza", "Da remoto", "Mista"];

  const filteredSoggetti = useMemo(() => {
    const q = soggettoFilter.trim().toLowerCase();
    if (!q) return soggetti.slice(0, 80);
    return soggetti
      .filter((s) => s.display.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 80);
  }, [soggetti, soggettoFilter]);

  const istanti = parti.filter((p) => p.ruolo === "Istante");
  const chiamati = parti.filter((p) => p.ruolo === "Chiamato");

  function updateParte(key: string, patch: Partial<DraftParte>) {
    setParti((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function removeParte(key: string) {
    setParti((prev) => prev.filter((p) => p.key !== key));
  }

  function parteLabel(p: DraftParte): string {
    if (p.mode === "existing") {
      const s = soggetti.find((x) => x.id === p.soggettoId);
      return s?.display || "(soggetto non selezionato)";
    }
    if (p.tipo === "Giuridica") {
      return p.ragione_sociale.trim() || "(nuova società)";
    }
    const n = [p.nome, p.cognome].map((x) => x.trim()).filter(Boolean).join(" ");
    return n || "(nuova persona)";
  }

  function canGoStep2(): boolean {
    return true; // mediazione can be minimal
  }

  function canGoStep3(): boolean {
    const valid = parti.filter((p) => {
      if (p.mode === "existing") return Boolean(p.soggettoId);
      if (p.tipo === "Giuridica") return Boolean(p.ragione_sociale.trim() || p.codice_fiscale.trim());
      return Boolean(p.nome.trim() || p.cognome.trim() || p.codice_fiscale.trim());
    });
    return valid.length > 0;
  }

  const partiJson = JSON.stringify(
    parti
      .filter((p) => {
        if (p.mode === "existing") return Boolean(p.soggettoId);
        if (p.tipo === "Giuridica") return Boolean(p.ragione_sociale.trim() || p.codice_fiscale.trim());
        return Boolean(p.nome.trim() || p.cognome.trim() || p.codice_fiscale.trim());
      })
      .map((p) =>
        p.mode === "existing"
          ? { ruolo: p.ruolo, soggettoId: p.soggettoId }
          : {
              ruolo: p.ruolo,
              soggettoId: "",
              tipo: p.tipo,
              nome: p.nome,
              cognome: p.cognome,
              ragione_sociale: p.ragione_sociale,
              codice_fiscale: p.codice_fiscale,
              email: p.email,
              pec: p.pec,
              indirizzo_riga_1: p.indirizzo_riga_1,
              numero_civico: p.numero_civico,
              comune: p.comune,
              provincia: p.provincia,
              cap: p.cap,
            },
      ),
  );

  return (
    <div className="w-full max-w-[1400px] mx-auto px-2 sm:px-4 pb-8">
      <div className="mb-4">
        <Link to="/mediazioni" className="text-sm text-slate-600 hover:text-slate-900">
          ← Elenco mediazioni
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 lg:p-8 shadow-sm">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-800">Nuova mediazione</h1>
            <p className="text-sm text-slate-500 mt-1">
              Walkthrough in 3 passi: dati pratica, parti, conferma.
            </p>
          </div>
        </div>

        {/* Stepper */}
        <ol className="mb-6 grid grid-cols-3 gap-2">
          {STEPS.map((s) => {
            const active = step === s.id;
            const done = step > s.id;
            return (
              <li
                key={s.id}
                className={`rounded-lg border px-3 py-2 ${
                  active
                    ? "border-[#3aaeba] bg-[#3aaeba]/10"
                    : done
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                          ? "bg-[#3aaeba] text-white"
                          : "bg-slate-300 text-white"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : s.id}
                  </span>
                  {s.title}
                </div>
                <p className="mt-0.5 pl-7 text-[11px] text-slate-500">{s.hint}</p>
              </li>
            );
          })}
        </ol>

        {loaderError && (
          <p className="mb-4 text-sm text-red-600" role="alert">
            {loaderError}
          </p>
        )}
        {actionData?.error && (
          <p className="mb-4 text-sm text-red-600" role="alert">
            {actionData.error}
          </p>
        )}

        <Form
          method="post"
          onSubmit={(e) => {
            // Prevent Enter / implicit submit on steps 1–2 from creating early
            if (step !== 3) {
              e.preventDefault();
              if (step === 1) setStep(2);
              else if (step === 2 && canGoStep3()) setStep(3);
            }
          }}
        >
          <input type="hidden" name="parti_json" value={partiJson} />

          {/* STEP 1 — always mounted so fields submit */}
          <div className={step === 1 ? "block" : "hidden"}>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-4">
              <div>
                <label htmlFor="rgm" className={labelClass}>
                  RGM
                  {proposedRgm ? (
                    <span className="ml-1 font-normal text-slate-400">(proposto {proposedRgm})</span>
                  ) : null}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="rgm"
                    name="rgm"
                    type="text"
                    className={`${inputClass} mt-0`}
                    value={rgm}
                    onChange={(e) => setRgm(e.target.value)}
                    placeholder="es. 42-2026"
                  />
                  {proposedRgm && rgm !== proposedRgm ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      onClick={() => setRgm(proposedRgm)}
                      title="Ripristina RGM proposto"
                    >
                      Usa proposto
                    </button>
                  ) : null}
                </div>
              </div>

              <div>
                <label htmlFor="mediatore" className={labelClass}>Mediatore</label>
                <select
                  id="mediatore"
                  name="mediatore"
                  className={inputClass}
                  value={mediatoreId}
                  onChange={(e) => setMediatoreId(e.target.value)}
                >
                  <option value="">— Da assegnare —</option>
                  {mediatori.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Se scelto, la pratica va in assegnata (con RGM se vuoto).
                </p>
              </div>

              <div>
                <label htmlFor="oggetto" className={labelClass}>Oggetto / Materia</label>
                <input
                  id="oggetto"
                  name="oggetto"
                  type="text"
                  list="materia-list-new"
                  value={oggetto}
                  onChange={(e) => setOggetto(e.target.value)}
                  className={inputClass}
                />
                <datalist id="materia-list-new">
                  {materiaOpzioni.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </div>

              {oggetto.trim().toLowerCase() === "altro" && (
                <div className="md:col-span-2 xl:col-span-3">
                  <label htmlFor="materia_altro" className={labelClass}>Materia (altro)</label>
                  <input id="materia_altro" name="materia_altro" type="text" className={inputClass} />
                </div>
              )}

              <div>
                <label htmlFor="data_deposito" className={labelClass}>Data deposito</label>
                <input id="data_deposito" name="data_deposito" type="date" className={inputClass} />
              </div>
              <div>
                <label htmlFor="data_protocollo" className={labelClass}>Data protocollo</label>
                <input id="data_protocollo" name="data_protocollo" type="date" className={inputClass} />
              </div>
              <div>
                <label htmlFor="data_avvio_entro" className={labelClass}>
                  Data avvio entro
                  <span className="ml-1 text-slate-400 font-normal text-xs">(giudice)</span>
                </label>
                <input id="data_avvio_entro" name="data_avvio_entro" type="date" className={inputClass} />
              </div>

              <div>
                <label htmlFor="valore" className={labelClass}>Valore</label>
                <input id="valore" name="valore" type="text" className={inputClass} />
              </div>
              <div>
                <label htmlFor="modalita_mediazione" className={labelClass}>Modalità mediazione</label>
                <select id="modalita_mediazione" name="modalita_mediazione" className={inputClass}>
                  <option value="">—</option>
                  {modalitaOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="modalita_convocazione" className={labelClass}>Modalità convocazione</label>
                <input
                  id="modalita_convocazione"
                  name="modalita_convocazione"
                  type="text"
                  className={inputClass}
                  placeholder="es. Raccomandata, PEC"
                />
              </div>

              <div>
                <label htmlFor="motivazione_deposito" className={labelClass}>Motivazione deposito</label>
                <input
                  id="motivazione_deposito"
                  name="motivazione_deposito"
                  type="text"
                  className={inputClass}
                  placeholder="es. condizione di procedibilità"
                />
              </div>
              <div>
                <label htmlFor="esito_finale" className={labelClass}>Esito finale</label>
                <select id="esito_finale" name="esito_finale" className={inputClass} defaultValue="">
                  <option value="">—</option>
                  {ESITO_FINALE_VALUES.map((esito) => (
                    <option key={esito} value={esito}>{esito}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="numero_esonerati_gratuito_patrocinio" className={labelClass}>
                  N. esonerati gratuito patrocinio
                </label>
                <input
                  id="numero_esonerati_gratuito_patrocinio"
                  name="numero_esonerati_gratuito_patrocinio"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={0}
                  className={inputClass}
                />
              </div>

              <div className="md:col-span-2 xl:col-span-3 flex flex-wrap gap-6 pt-1">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="trasmessa" value="true" className="rounded border-slate-300" />
                  Trasmessa
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="proposta_mediatore" value="true" className="rounded border-slate-300" />
                  Proposta mediatore
                </label>
              </div>
            </div>
          </div>

          {/* STEP 2 — parti */}
          <div className={step === 2 ? "block space-y-5" : "hidden"}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600">
                Aggiungi almeno un istante o un chiamato. Puoi scegliere dalla rubrica o crearne uno nuovo.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setParti((p) => [...p, emptyParte("Istante")])}
                  className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Istante
                </button>
                <button
                  type="button"
                  onClick={() => setParti((p) => [...p, emptyParte("Chiamato")])}
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100"
                >
                  <Plus className="h-3.5 w-3.5" /> Chiamato
                </button>
              </div>
            </div>

            <div>
              <label className={labelClass}>Filtra rubrica</label>
              <input
                type="search"
                value={soggettoFilter}
                onChange={(e) => setSoggettoFilter(e.target.value)}
                className={inputClass}
                placeholder="Cerca per nome, CF, ragione sociale…"
              />
            </div>

            {parti.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                Nessuna parte. Aggiungi un istante o un chiamato.
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {parti.map((p, idx) => (
                  <div
                    key={p.key}
                    className={`rounded-xl border p-4 ${
                      p.ruolo === "Istante" ? "border-sky-200 bg-sky-50/40" : "border-violet-200 bg-violet-50/40"
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-slate-500" />
                        <span className="text-sm font-semibold text-slate-800">
                          {p.ruolo} #{idx + 1}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeParte(p.key)}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Rimuovi parte"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Ruolo</label>
                        <select
                          className={inputClass}
                          value={p.ruolo}
                          onChange={(e) =>
                            updateParte(p.key, { ruolo: e.target.value as DraftParteRuolo })
                          }
                        >
                          <option value="Istante">Istante</option>
                          <option value="Chiamato">Chiamato</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Fonte</label>
                        <select
                          className={inputClass}
                          value={p.mode}
                          onChange={(e) =>
                            updateParte(p.key, { mode: e.target.value as DraftParteMode })
                          }
                        >
                          <option value="existing">Dalla rubrica</option>
                          <option value="new">Nuovo soggetto</option>
                        </select>
                      </div>
                    </div>

                    {p.mode === "existing" ? (
                      <div className="mt-3">
                        <label className={labelClass}>Soggetto</label>
                        <select
                          className={inputClass}
                          value={p.soggettoId}
                          onChange={(e) => updateParte(p.key, { soggettoId: e.target.value })}
                        >
                          <option value="">— Seleziona —</option>
                          {filteredSoggetti.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.display}{s.tipo ? ` (${s.tipo})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className={labelClass}>Tipo</label>
                          <select
                            className={inputClass}
                            value={p.tipo}
                            onChange={(e) =>
                              updateParte(p.key, { tipo: e.target.value as DraftParteTipo })
                            }
                          >
                            <option value="Fisica">Persona fisica</option>
                            <option value="Giuridica">Persona giuridica</option>
                          </select>
                        </div>
                        {p.tipo === "Fisica" ? (
                          <>
                            <div>
                              <label className={labelClass}>Nome</label>
                              <input
                                className={inputClass}
                                value={p.nome}
                                onChange={(e) => updateParte(p.key, { nome: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className={labelClass}>Cognome</label>
                              <input
                                className={inputClass}
                                value={p.cognome}
                                onChange={(e) => updateParte(p.key, { cognome: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className={labelClass}>Codice fiscale</label>
                              <input
                                className={inputClass}
                                value={p.codice_fiscale}
                                onChange={(e) =>
                                  updateParte(p.key, { codice_fiscale: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <label className={labelClass}>Email</label>
                              <input
                                className={inputClass}
                                value={p.email}
                                onChange={(e) => updateParte(p.key, { email: e.target.value })}
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="sm:col-span-2">
                              <label className={labelClass}>Ragione sociale</label>
                              <input
                                className={inputClass}
                                value={p.ragione_sociale}
                                onChange={(e) =>
                                  updateParte(p.key, { ragione_sociale: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <label className={labelClass}>Codice fiscale / P.IVA</label>
                              <input
                                className={inputClass}
                                value={p.codice_fiscale}
                                onChange={(e) =>
                                  updateParte(p.key, { codice_fiscale: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <label className={labelClass}>PEC</label>
                              <input
                                className={inputClass}
                                value={p.pec}
                                onChange={(e) => updateParte(p.key, { pec: e.target.value })}
                              />
                            </div>
                          </>
                        )}
                        <div className="sm:col-span-2">
                          <label className={labelClass}>Indirizzo</label>
                          <input
                            className={inputClass}
                            value={p.indirizzo_riga_1}
                            onChange={(e) =>
                              updateParte(p.key, { indirizzo_riga_1: e.target.value })
                            }
                            placeholder="Via / Piazza"
                          />
                        </div>
                        <div>
                          <label className={labelClass}>N. civico</label>
                          <input
                            className={inputClass}
                            value={p.numero_civico}
                            onChange={(e) => updateParte(p.key, { numero_civico: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>CAP</label>
                          <input
                            className={inputClass}
                            value={p.cap}
                            onChange={(e) => updateParte(p.key, { cap: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Comune</label>
                          <input
                            className={inputClass}
                            value={p.comune}
                            onChange={(e) => updateParte(p.key, { comune: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Provincia</label>
                          <input
                            className={inputClass}
                            value={p.provincia}
                            onChange={(e) => updateParte(p.key, { provincia: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!canGoStep3() && (
              <p className="text-xs text-amber-700">
                Completa almeno una parte (selezione rubrica o anagrafica nuova) per continuare.
              </p>
            )}
          </div>

          {/* STEP 3 — conferma */}
          <div className={step === 3 ? "block space-y-4" : "hidden"}>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <h2 className="font-semibold text-slate-800 mb-2">Dati mediazione</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2 text-slate-700">
                <div><dt className="text-xs text-slate-500">RGM</dt><dd>{rgm.trim() || "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Mediatore</dt><dd>{mediatoreName || "Da assegnare"}</dd></div>
                <div><dt className="text-xs text-slate-500">Oggetto</dt><dd>{oggetto || "—"}</dd></div>
                <div>
                  <dt className="text-xs text-slate-500">Parti</dt>
                  <dd>{istanti.length} istanti · {chiamati.length} chiamati</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <h2 className="font-semibold text-slate-800 mb-2 text-sm">Parti che verranno create</h2>
              <ul className="space-y-2 text-sm">
                {parti
                  .filter((p) => {
                    if (p.mode === "existing") return Boolean(p.soggettoId);
                    if (p.tipo === "Giuridica") {
                      return Boolean(p.ragione_sociale.trim() || p.codice_fiscale.trim());
                    }
                    return Boolean(p.nome.trim() || p.cognome.trim() || p.codice_fiscale.trim());
                  })
                  .map((p) => (
                    <li
                      key={p.key}
                      className="flex items-center justify-between rounded-md border border-slate-100 bg-white px-3 py-2"
                    >
                      <span>
                        <span
                          className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            p.ruolo === "Istante"
                              ? "bg-sky-100 text-sky-700"
                              : "bg-violet-100 text-violet-700"
                          }`}
                        >
                          {p.ruolo}
                        </span>
                        {parteLabel(p)}
                      </span>
                      <span className="text-xs text-slate-400">
                        {p.mode === "existing" ? "rubrica" : "nuovo"}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            <p className="text-xs text-slate-500">
              {mediatoreId
                ? "Con mediatore selezionato la pratica sarà assegnata (RGM mantenuto se già indicato)."
                : "Senza mediatore la pratica resta in stato registrata (Da assegnare)."}{" "}
              Gli avvocati si possono collegare dopo dalla scheda.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-5 border-t border-slate-100 mt-5">
            <div className="flex gap-2">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(1, s - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ChevronLeft className="h-4 w-4" /> Indietro
                </button>
              ) : (
                <Link
                  to="/mediazioni"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Annulla
                </Link>
              )}
            </div>

            <div className="flex gap-2">
              {step < 3 ? (
                <button
                  type="button"
                  disabled={
                    Boolean(loaderError) ||
                    (step === 1 && !canGoStep2()) ||
                    (step === 2 && !canGoStep3())
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setStep((s) => Math.min(3, s + 1));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#3aaeba] px-4 py-2 text-sm font-medium text-white hover:bg-[#349aa5] disabled:opacity-50"
                >
                  Avanti <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  name="_intent"
                  value="create"
                  disabled={isSubmitting || Boolean(loaderError) || !canGoStep3()}
                  className="rounded-lg bg-[#3aaeba] px-4 py-2 text-sm font-medium text-white hover:bg-[#349aa5] disabled:opacity-50"
                >
                  {isSubmitting ? "Creazione…" : "Crea mediazione"}
                </button>
              )}
            </div>
          </div>
        </Form>
      </div>
    </div>
  );
}
