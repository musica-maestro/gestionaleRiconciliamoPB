import JSZip from "jszip";
import type PocketBase from "pocketbase";
import * as XLSX from "xlsx";
import {
  competenzeAttiveKeySet,
  shouldUseAccordoOrganismiModello,
} from "~/lib/competenza";
import { fillWordMergeFields } from "~/lib/docx-merge-fields.server";
import { convertDocxToPdf, mergePdfs } from "~/lib/gotenberg.server";
import {
  MODELLO_CONVOCAZIONE_PF_ACCORDO,
  MODELLO_CONVOCAZIONE_PF_ART4,
  MODELLO_CONVOCAZIONE_PG_ACCORDO,
  MODELLO_CONVOCAZIONE_PG_ART4,
  MODELLO_MODULO_ADESIONE,
  MODELLI_NOTIFICHE_NOMI,
  TIPI_DOCUMENTO_ISTANZA,
} from "~/lib/modelli-notifiche";

const CHECKBOX_UNCHECKED = "\u25A1";
const CHECKBOX_CHECKED = "X";

/** Materia labels in template order (mat1…mat21). */
const MATERIA_LABELS = [
  "condominio",
  "diritti reali",
  "divisione",
  "successioni ereditarie",
  "patti di famiglia",
  "locazione",
  "comodato",
  "affitto di aziende",
  "contratti assicurativi",
  "contratti bancari e finanziari",
  "contratti di somministrazione",
  "contratti di sub-fornitura",
  "contratti d'opera",
  "contratti di rete",
  "consorzio",
  "franchising",
  "società di persone",
  "associazione in partecipazione",
  "risarcimento del danno derivante da responsabilità medica e sanitaria",
  "risarcimento del danno derivante da diffamazione con il mezzo della stampa o altro mezzo di pubblicità",
  "altro",
];

const FLUSSO_CSV_HEADERS =
  "id_lesive;RagioneSociale;CAP;Citta;Provincia;Stato;Indirizzo;CompletamentoIndirizzo;CompletamentoNominativo;NomeFile;CodiceFiscale;Telefono;sms;testoSms;code_mittente;code_mittente_return";

/** Fixed Poste Speciale mittente code for Riconciliamo flusso export (same columns as Talento). */
const FLUSSO_CODE_MITTENTE = "00025AYPRX";

const MONTHS_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

export type FlussoRow = {
  id_lesive: string;
  RagioneSociale: string;
  CAP: string;
  Citta: string;
  Provincia: string;
  Stato: string;
  Indirizzo: string;
  CompletamentoIndirizzo: string;
  CompletamentoNominativo: string;
  NomeFile: string;
  CodiceFiscale: string;
  Telefono: string;
  sms: string;
  testoSms: string;
  code_mittente: string;
  code_mittente_return: string;
};

export type ProgressCallback = (current: number, total: number, label?: string) => void;

export type FlussoPhase = "check" | "generate" | "mail";

export type FlussoStepCallback = (event: {
  phase: FlussoPhase;
  current: number;
  total: number;
  label?: string;
}) => void;

export class FlussoExportError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    const unique = [...new Set(errors.filter(Boolean))];
    super(unique.join("\n"));
    this.name = "FlussoExportError";
    this.errors = unique;
  }
}

type SoggettoLite = {
  id: string;
  tipo?: string;
  nome?: string;
  cognome?: string;
  codice_fiscale?: string;
  ragione_sociale?: string;
  piva?: string;
  pec?: string;
  email?: string;
  indirizzo_riga_1?: string;
  indirizzo_riga_2?: string;
  numero_civico?: string;
  comune?: string;
  provincia?: string;
  cap?: string;
  paese?: string;
};

type AvvocatoLite = {
  id: string;
  nome?: string;
  cognome?: string;
  pec?: string;
  telefono?: string;
  codice_fiscale?: string;
  indirizzo?: string;
};

type PartecipazioneLite = {
  id: string;
  mediazione: string;
  soggetto: string;
  istante_o_chiamato?: string;
  avvocati?: string[];
};

export type ExportedMediazione = {
  mediazioneId: string;
  rgm: string;
  codiceUnivocoCliente: string;
  dataIncontro: Date | null;
  chiamatoNome: string;
  oggetto: string;
  istanteAvvocatoIds: string[];
  mediatoreName: string;
};

function escapeFlussoField(v: string): string {
  const s = v ?? "";
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildFlussoCsv(rows: FlussoRow[]): string {
  const line = (r: FlussoRow) =>
    [
      r.id_lesive,
      r.RagioneSociale,
      r.CAP,
      r.Citta,
      r.Provincia,
      r.Stato,
      r.Indirizzo,
      r.CompletamentoIndirizzo,
      r.CompletamentoNominativo,
      r.NomeFile,
      r.CodiceFiscale,
      r.Telefono,
      r.sms,
      r.testoSms,
      r.code_mittente,
      r.code_mittente_return,
    ]
      .map(escapeFlussoField)
      .join(";");
  return [FLUSSO_CSV_HEADERS, ...rows.map(line)].join("\n");
}

function sanitizeFilePart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function fetchPbFileBuffer(
  pb: PocketBase,
  record: { id: string; [k: string]: unknown },
  filename: string,
): Promise<Buffer | null> {
  if (!filename) return null;
  try {
    const token = await pb.files.getToken();
    const url = pb.files.getUrl(record as never, filename, { token });
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Try to download a legacy istanza URL (direct PDF or public Google Drive). */
async function fetchLegacyPdfBuffer(link: string): Promise<Buffer | null> {
  const raw = link.trim();
  if (!raw) return null;
  const candidates = [raw];
  const driveId =
    raw.match(/\/file\/d\/([^/]+)/)?.[1] ??
    raw.match(/[?&]id=([^&]+)/)?.[1] ??
    null;
  if (driveId) {
    candidates.unshift(`https://drive.google.com/uc?export=download&id=${driveId}`);
  }
  for (const url of candidates) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // PDF magic
      if (buf.length > 4 && buf.subarray(0, 4).toString("utf8") === "%PDF") return buf;
    } catch {
      // try next
    }
  }
  return null;
}

async function resolveIstanzaPdf(
  pb: PocketBase,
  mediazioneId: string,
  tipoIds: string[],
): Promise<{ buf: Buffer | null; note?: string }> {
  if (tipoIds.length === 0) return { buf: null, note: "nessun tipo istanza/richiesta configurato" };

  // Avoid `mediazione = X && (tipo = A || tipo = B)` — PocketBase 400s that filter
  // shape with the documenti listRule joins. Fetch by mediazione and filter in JS.
  const tipoSet = new Set(tipoIds);
  let allDocs: Array<{ id: string; tipo?: string; file?: string; link_legacy?: string }> = [];
  try {
    // `documenti` has no created/updated columns — sorting by them returns 400.
    allDocs = (await pb.collection("documenti").getFullList({
      filter: `mediazione = "${mediazioneId}"`,
      sort: "-id",
      requestKey: null,
    })) as typeof allDocs;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { buf: null, note: `documenti non leggibili (${msg})` };
  }

  const docs = allDocs.filter((d) => tipoSet.has(String(d.tipo ?? "")));

  // Prefer uploaded file
  for (const d of docs) {
    const file = String(d.file ?? "");
    if (!file) continue;
    const buf = await fetchPbFileBuffer(pb, d, file);
    if (buf) return { buf };
  }

  // Fallback: legacy link (Drive / URL)
  for (const d of docs) {
    const link = String(d.link_legacy ?? "");
    if (!link) continue;
    const buf = await fetchLegacyPdfBuffer(link);
    if (buf) return { buf };
    return {
      buf: null,
      note: `istanza solo link legacy non scaricabile (${link.slice(0, 60)}…)`,
    };
  }

  return { buf: null, note: "istanza/richiesta assente" };
}

/** Italian CF: day > 40 → female. */
export function genderFromCodiceFiscale(cf: string | undefined | null): "F" | "M" {
  const s = (cf ?? "").trim().toUpperCase();
  if (s.length < 11) return "M";
  const day = Number.parseInt(s.slice(9, 11), 10);
  if (!Number.isFinite(day)) return "M";
  return day > 40 ? "F" : "M";
}

function partsInRome(d: Date): { day: number; month: number; year: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    day: Number(map.day),
    month: Number(map.month),
    year: Number(map.year),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
  };
}

function formatDataTestuale(d: Date): string {
  const p = partsInRome(d);
  return `${p.day} ${MONTHS_IT[p.month - 1]} ${p.year}`;
}

function formatOraTestuale(d: Date): string {
  const p = partsInRome(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function parsePbDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function soggettoDisplayName(s: SoggettoLite | null | undefined): string {
  if (!s) return "";
  if (String(s.tipo ?? "") === "Giuridica") {
    return String(s.ragione_sociale ?? "").trim();
  }
  return [s.nome, s.cognome].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
}

function soggettoCognomeOrRs(s: SoggettoLite | null | undefined): string {
  if (!s) return "";
  if (String(s.tipo ?? "") === "Giuridica") {
    return String(s.ragione_sociale ?? "").trim();
  }
  return String(s.cognome ?? "").trim();
}

/** True when the soggetto has a usable identity (skip empty placeholder rows). */
function soggettoHasIdentity(s: SoggettoLite | null | undefined): boolean {
  return Boolean(soggettoDisplayName(s));
}

function soggettoHasPostalAddress(s: SoggettoLite | null | undefined): boolean {
  if (!s) return false;
  return Boolean(
    String(s.indirizzo_riga_1 ?? "").trim() &&
      String(s.comune ?? "").trim() &&
      String(s.cap ?? "").trim(),
  );
}

/**
 * Prefer soggetti with name/ragione sociale and (for chiamato) a postal address.
 * Empty Fisica placeholders from bad imports must not win over persone giuridiche.
 */
function pickBestSoggetto(
  candidates: SoggettoLite[],
  opts?: { preferAddress?: boolean },
): SoggettoLite | null {
  const named = candidates.filter(soggettoHasIdentity);
  const pool = named.length > 0 ? named : candidates;
  if (pool.length === 0) return null;
  if (opts?.preferAddress) {
    const withAddr = pool.filter(soggettoHasPostalAddress);
    if (withAddr.length > 0) return withAddr[0];
  }
  // Prefer Giuridica when both kinds are present (common for company-vs-placeholder noise).
  const giuridica = pool.find((s) => String(s.tipo ?? "") === "Giuridica");
  return giuridica ?? pool[0];
}

function materiaCheckboxes(oggetto: string): Record<string, string> {
  const out: Record<string, string> = {};
  const norm = oggetto.trim().toLowerCase();
  for (let i = 0; i < 21; i++) {
    const key = `mat${i + 1}`;
    const label = MATERIA_LABELS[i] ?? "";
    const match =
      norm.length > 0 &&
      (norm === label ||
        norm.includes(label) ||
        label.includes(norm) ||
        (norm === "altro" && i === 20));
    out[key] = match ? CHECKBOX_CHECKED : CHECKBOX_UNCHECKED;
  }
  // Talento-style default for diffamazione if oggetto empty-ish but looks like lesiva matter
  if (!Object.values(out).includes(CHECKBOX_CHECKED) && /diffam/.test(norm)) {
    out.mat20 = CHECKBOX_CHECKED;
  }
  return out;
}

export function selectConvocazioneModelloNome(
  chiamatoTipo: string,
  useAccordoOrganismi: boolean,
): string {
  const giuridica = chiamatoTipo === "Giuridica";
  if (giuridica) {
    return useAccordoOrganismi
      ? MODELLO_CONVOCAZIONE_PG_ACCORDO
      : MODELLO_CONVOCAZIONE_PG_ART4;
  }
  return useAccordoOrganismi
    ? MODELLO_CONVOCAZIONE_PF_ACCORDO
    : MODELLO_CONVOCAZIONE_PF_ART4;
}

function buildConvocazioneData(opts: {
  rgm: string;
  chiamato: SoggettoLite;
  istante: SoggettoLite | null;
  mediatoreName: string;
  mediatoreFemale: boolean;
  dataIncontro: Date;
  dataDeposito: Date | null;
}): Record<string, string> {
  const { chiamato, istante, rgm, mediatoreName, mediatoreFemale, dataIncontro, dataDeposito } =
    opts;
  const female = genderFromCodiceFiscale(chiamato.codice_fiscale) === "F";
  const isGiuridica = String(chiamato.tipo ?? "") === "Giuridica";

  return {
    RGM: rgm,
    Cognome_Istante: soggettoCognomeOrRs(istante),
    Nome_chiamato: String(chiamato.nome ?? "").trim(),
    Cognome_chiamato: String(chiamato.cognome ?? "").trim(),
    Ragione_Sociale: String(chiamato.ragione_sociale ?? "").trim(),
    Indirizzo: String(chiamato.indirizzo_riga_1 ?? "").trim(),
    Numero_civico: String(chiamato.numero_civico ?? "").trim(),
    Comune: String(chiamato.comune ?? "").trim(),
    Provincia: String(chiamato.provincia ?? "").trim(),
    Data_incontro_testuale: formatDataTestuale(dataIncontro),
    Ora_testuale: formatOraTestuale(dataIncontro),
    Data_deposito_testuale: dataDeposito ? formatDataTestuale(dataDeposito) : "",
    Mediatore: mediatoreName,
    Dott_ssa: mediatoreFemale ? "Dott.ssa" : "Dott.",
    Gentma_SigraEgr_Sig: isGiuridica ? "" : female ? "Gent.ma Sig.ra" : "Egr. Sig.",
    Il_destinatarioLa_destinataria_: isGiuridica
      ? "il destinatario"
      : female
        ? "la destinataria"
        : "il destinatario",
    deldella_SigSigra: isGiuridica ? "di" : female ? "della Sig.ra" : "del Sig.",
  };
}

function buildAdesioneData(opts: {
  rgm: string;
  chiamato: SoggettoLite;
  avvocato: AvvocatoLite | null;
  oggetto: string;
}): Record<string, string> {
  const { chiamato, avvocato, rgm, oggetto } = opts;
  const isGiuridica = String(chiamato.tipo ?? "") === "Giuridica";
  const sede = [
    chiamato.indirizzo_riga_1,
    chiamato.numero_civico,
    chiamato.indirizzo_riga_2,
    [chiamato.cap, chiamato.comune, chiamato.provincia].filter(Boolean).join(" "),
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join(", ");

  // Persona fisica: keep the previous export mapping unchanged.
  // Persona giuridica: same PG + avvocato fields, but leave the PF block empty
  // so address/PEC are not duplicated into "PARTE CHIAMATA PERSONA FISICA".
  const base = {
    RGM: rgm,
    Nome_Chiamato: String(chiamato.nome ?? "").trim(),
    Cognome_Chiamato: String(chiamato.cognome ?? "").trim(),
    Ragione_Sociale: String(chiamato.ragione_sociale ?? "").trim(),
    CF_Chiamato: String(chiamato.codice_fiscale ?? "").trim(),
    CF_PIVA_Persona_Giuridica: isGiuridica
      ? [chiamato.codice_fiscale, chiamato.piva].filter(Boolean).join(" / ")
      : "",
    Sede_Legale: isGiuridica ? sede : "",
    PEC_Persona_Giuridica: String(chiamato.pec ?? "").trim(),
    Indirizzo1: String(chiamato.indirizzo_riga_1 ?? "").trim(),
    Numero_civico: String(chiamato.numero_civico ?? "").trim(),
    Riga_2: String(chiamato.indirizzo_riga_2 ?? "").trim(),
    Comune: String(chiamato.comune ?? "").trim(),
    Provincia: String(chiamato.provincia ?? "").trim(),
    PEC: String(chiamato.pec ?? chiamato.email ?? "").trim(),
    Nome_Avvocato: String(avvocato?.nome ?? "").trim(),
    Cognome_Avvocato: String(avvocato?.cognome ?? "").trim(),
    CF_Avvocato: String(avvocato?.codice_fiscale ?? "").trim(),
    Indirizzo_Avvocato: String(avvocato?.indirizzo ?? "").trim(),
    Telefono_Avvocato: String(avvocato?.telefono ?? "").trim(),
    PEC_Avvocato: String(avvocato?.pec ?? "").trim(),
    ...materiaCheckboxes(oggetto),
  };

  if (!isGiuridica) return base;

  return {
    ...base,
    Nome_Chiamato: "",
    Cognome_Chiamato: "",
    CF_Chiamato: "",
    Indirizzo1: "",
    Numero_civico: "",
    Riga_2: "",
    Comune: "",
    Provincia: "",
    PEC: "",
  };
}

async function loadModelliBuffers(
  pb: PocketBase,
): Promise<{ buffers: Record<string, Buffer>; missing: string[] }> {
  const buffers: Record<string, Buffer> = {};
  const missing: string[] = [];
  for (const nome of [...MODELLI_NOTIFICHE_NOMI]) {
    const list = await pb.collection("modelli_documenti").getList(1, 1, {
      filter: `nome = "${nome.replace(/"/g, '\\"')}" && attivo = true`,
      sort: "-updated",
    });
    let modello = list.items[0] as { id: string; file?: string } | undefined;
    if (!modello) {
      const any = await pb.collection("modelli_documenti").getList(1, 1, {
        filter: `nome = "${nome.replace(/"/g, '\\"')}"`,
        sort: "-updated",
      });
      modello = any.items[0] as { id: string; file?: string } | undefined;
    }
    if (!modello?.file) {
      missing.push(nome);
      continue;
    }
    const buf = await fetchPbFileBuffer(pb, modello, String(modello.file));
    if (!buf) {
      missing.push(nome);
      continue;
    }
    buffers[nome] = buf;
  }
  return { buffers, missing };
}

function buildEml(opts: {
  to: string;
  subject: string;
  body: string;
  attachmentName: string;
  attachmentBuffer: Buffer;
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const b64 = opts.attachmentBuffer.toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.body,
    "",
    `--${boundary}`,
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${opts.attachmentName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${opts.attachmentName}"`,
    "",
    b64,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function buildAvvocatoXlsx(
  rows: Array<{
    codiceUnivocoCliente: string;
    rgm: string;
    dataIncontro: string;
    mediatore: string;
    dataExport: string;
    chiamato: string;
    oggetto: string;
  }>,
): Buffer {
  const sheetRows = rows.map((r) => ({
    "Codice univoco cliente": r.codiceUnivocoCliente,
    RGM: r.rgm,
    "Data incontro": r.dataIncontro,
    Mediatore: r.mediatore,
    "Data export": r.dataExport,
    Chiamato: r.chiamato,
    Oggetto: r.oggetto,
  }));
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Mediazioni");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

type PreparedFlussoRow = {
  mediazioneId: string;
  rgm: string;
  oggetto: string;
  codiceUnivoco: string;
  chiamato: SoggettoLite;
  istante: SoggettoLite | null;
  dataIncontro: Date;
  dataDeposito: Date | null;
  modelloNome: string;
  avvocatoChiamato: AvvocatoLite | null;
  istanteAvvocatoIds: string[];
  istanzaBuf: Buffer;
  mediatoreName: string;
  mediatoreFemale: boolean;
};

function formatCaughtError(e: unknown, prefix: string): string {
  const err = e as {
    message?: string;
    status?: number;
    url?: string;
  };
  const parts = [
    err.message ?? (e instanceof Error ? e.message : String(e)),
    err.status != null ? `HTTP ${err.status}` : null,
    err.url ? err.url.replace(/^https?:\/\/[^/]+/, "") : null,
  ].filter(Boolean);
  return `${prefix}: ${parts.join(" — ")}`;
}

/**
 * Build the full flusso notifiche ZIP for da-convocare mediazioni.
 * Phase 1: validate all pratiche. Phase 2: generate. Any error → no ZIP.
 */
export async function buildFlussoNotificheZip(
  pb: PocketBase,
  mediazioneIds: string[],
  onStep?: FlussoStepCallback,
): Promise<{ zip: Buffer; report: string[]; okCount: number; mailCount: number }> {
  const ids = [...new Set(mediazioneIds.filter(Boolean))];
  if (ids.length === 0) {
    throw new FlussoExportError(["Nessuna mediazione da esportare"]);
  }

  const { buffers: modelliBuf, missing } = await loadModelliBuffers(pb);
  if (missing.length > 0) {
    throw new FlussoExportError([
      `Modelli mancanti o non leggibili: ${missing.join(", ")}. ` +
        `Caricali in Impostazioni → Modelli (admin) e verifica che siano attivi.`,
    ]);
  }

  const competenzeAttive = await pb
    .collection("competenza_opzioni")
    .getFullList<{ nome: string; attivo?: boolean }>({ filter: "attivo = true" })
    .catch(() => [] as { nome: string; attivo?: boolean }[]);
  // Keys are lowercased (ROMA → roma) so they match active DB options case-insensitively.
  const competenzeSet = competenzeAttiveKeySet(competenzeAttive);

  const tipiIstanzaResp = await pb
    .collection("documenti_tipi")
    .getFullList<{ id: string; nome: string }>({
      filter: TIPI_DOCUMENTO_ISTANZA.map((n) => `nome = "${n.replace(/"/g, '\\"')}"`).join(" || "),
    })
    .catch(() => [] as { id: string; nome: string }[]);
  const tipoIstanzaIds = tipiIstanzaResp.map((t) => t.id);
  if (tipoIstanzaIds.length === 0) {
    throw new FlussoExportError([
      `Tipi documento ${TIPI_DOCUMENTO_ISTANZA.join(" / ")} non trovati — impossibile allegare le istanze.`,
    ]);
  }

  const checkErrors: string[] = [];
  const prepared: PreparedFlussoRow[] = [];
  const avvocatiCache = new Map<string, AvvocatoLite>();
  const usersCache = new Map<string, { name?: string; sesso?: string }>();
  const total = ids.length;

  // ── Phase 1: check ────────────────────────────────────────────────────────
  for (let i = 0; i < ids.length; i++) {
    const mediazioneId = ids[i];
    onStep?.({ phase: "check", current: i + 1, total, label: mediazioneId });

    try {
      const mediazione = await pb.collection("mediazioni").getOne(mediazioneId);
      const rgm = String(mediazione.rgm ?? "").trim();
      const label = rgm || mediazioneId;
      const oggetto = String(mediazione.oggetto ?? "").trim();
      const competenza = String(mediazione.competenza ?? "").trim();
      // Active territorialità → Art. 4 model; outside list → accordo organismi.
      const useAccordoOrganismi = shouldUseAccordoOrganismiModello(
        competenza,
        competenzeSet,
      );
      const codiceUnivoco = String(mediazione.codice_univoco_cliente ?? "").trim();

      const partecipazioni = (await pb.collection("partecipazioni").getFullList({
        filter: `mediazione = "${mediazioneId}"`,
      })) as unknown as PartecipazioneLite[];

      const chiamatiP = partecipazioni.filter((p) => p.istante_o_chiamato === "Chiamato");
      const istantiP = partecipazioni.filter((p) => p.istante_o_chiamato === "Istante");
      if (chiamatiP.length === 0) {
        checkErrors.push(`${label}: nessun chiamato`);
        continue;
      }

      const soggettiById = new Map<string, SoggettoLite>();
      const loadSoggetto = async (sid: string) => {
        let s = soggettiById.get(sid);
        if (!s) {
          s = (await pb.collection("soggetti").getOne(sid)) as unknown as SoggettoLite;
          soggettiById.set(sid, s);
        }
        return s;
      };

      const chiamatiSoggetti = await Promise.all(
        chiamatiP.map(async (p) => ({
          p,
          s: await loadSoggetto(String(p.soggetto)),
        })),
      );
      const istantiSoggetti = await Promise.all(
        istantiP.map(async (p) => ({
          p,
          s: await loadSoggetto(String(p.soggetto)),
        })),
      );

      const chiamato = pickBestSoggetto(
        chiamatiSoggetti.map((x) => x.s),
        { preferAddress: true },
      );
      const istante = pickBestSoggetto(istantiSoggetti.map((x) => x.s));
      if (!chiamato) {
        checkErrors.push(`${label}: nessun chiamato`);
        continue;
      }
      const chiamatoPartecipazione =
        chiamatiSoggetti.find((x) => x.s.id === chiamato.id)?.p ?? chiamatiP[0];

      const incontri = await pb.collection("incontri").getFullList({
        filter: `mediazione = "${mediazioneId}"`,
        sort: "data_programmazione",
      });
      const dataIncontro = parsePbDate(
        (incontri[0] as { data_programmazione?: string } | undefined)?.data_programmazione,
      );
      const dataDeposito = parsePbDate(mediazione.data_deposito ?? mediazione.data_protocollo);

      const rowErrors: string[] = [];
      if (!rgm) rowErrors.push("RGM mancante");
      // codice_univoco_cliente is optional (often empty for pratiche con sole persone giuridiche)
      if (!dataIncontro) rowErrors.push("data incontro mancante");
      if (!String(chiamato.indirizzo_riga_1 ?? "").trim()) rowErrors.push("indirizzo chiamato mancante");
      if (!String(chiamato.comune ?? "").trim()) rowErrors.push("comune chiamato mancante");
      if (!String(chiamato.cap ?? "").trim()) rowErrors.push("CAP chiamato mancante");
      if (!istante || !soggettoHasIdentity(istante)) rowErrors.push("istante mancante");

      const modelloNome = selectConvocazioneModelloNome(
        String(chiamato.tipo ?? "Fisica"),
        useAccordoOrganismi,
      );
      if (!modelliBuf[modelloNome]) rowErrors.push(`modello "${modelloNome}" non caricato`);
      if (!modelliBuf[MODELLO_MODULO_ADESIONE]) {
        rowErrors.push(`modello "${MODELLO_MODULO_ADESIONE}" non caricato`);
      }

      const { buf: istanzaBuf, note: istanzaNote } = await resolveIstanzaPdf(
        pb,
        mediazioneId,
        tipoIstanzaIds,
      );
      if (!istanzaBuf) {
        rowErrors.push(istanzaNote ? `istanza: ${istanzaNote}` : "istanza/richiesta assente");
      }

      if (rowErrors.length > 0) {
        checkErrors.push(
          `${rgm || soggettoDisplayName(chiamato) || mediazioneId}: ${rowErrors.join("; ")}`,
        );
        continue;
      }

      let mediatoreName = "";
      let mediatoreFemale = false;
      const mediatoreId = String(mediazione.mediatore ?? "").trim();
      if (!mediatoreId) {
        checkErrors.push(`${rgm || mediazioneId}: mediatore mancante`);
        continue;
      }
      {
        let user = usersCache.get(mediatoreId);
        if (!user) {
          user = (await pb.collection("users").getOne(mediatoreId)) as {
            name?: string;
            sesso?: string;
          };
          usersCache.set(mediatoreId, user);
        }
        mediatoreName = String(user.name ?? "").trim();
        mediatoreFemale = String(user.sesso ?? "").toLowerCase() === "female";
      }
      if (!mediatoreName) {
        checkErrors.push(`${rgm || mediazioneId}: nome mediatore mancante`);
        continue;
      }

      let avvocatoChiamato: AvvocatoLite | null = null;
      const avvIdsChiamato = chiamatoPartecipazione.avvocati ?? [];
      if (avvIdsChiamato.length > 0) {
        const aid = String(avvIdsChiamato[0]);
        let a = avvocatiCache.get(aid);
        if (!a) {
          a = (await pb.collection("avvocati").getOne(aid)) as unknown as AvvocatoLite;
          avvocatiCache.set(aid, a);
        }
        avvocatoChiamato = a;
      }

      const istanteAvvocatoIds = [
        ...new Set(
          istantiP.flatMap((p) => (p.avvocati ?? []).map((id) => String(id)).filter(Boolean)),
        ),
      ];
      if (istanteAvvocatoIds.length === 0) {
        checkErrors.push(`${rgm || mediazioneId}: avvocato istante mancante (mail riscontro non generabile)`);
        continue;
      }

      prepared.push({
        mediazioneId,
        rgm,
        oggetto,
        codiceUnivoco,
        chiamato,
        istante,
        dataIncontro: dataIncontro!,
        dataDeposito,
        modelloNome,
        avvocatoChiamato,
        istanteAvvocatoIds,
        istanzaBuf: istanzaBuf!,
        mediatoreName,
        mediatoreFemale,
      });
    } catch (e) {
      checkErrors.push(formatCaughtError(e, mediazioneId));
    }
  }

  // Validate istante lawyers (mail) during check — no partial ZIP later
  const allIstanteAvvIds = [
    ...new Set(prepared.flatMap((r) => r.istanteAvvocatoIds)),
  ];
  for (const avvocatoId of allIstanteAvvIds) {
    try {
      let avv = avvocatiCache.get(avvocatoId);
      if (!avv) {
        avv = (await pb.collection("avvocati").getOne(avvocatoId)) as unknown as AvvocatoLite;
        avvocatiCache.set(avvocatoId, avv);
      }
      const pec = String(avv.pec ?? "").trim();
      const label = [avv.cognome, avv.nome].filter(Boolean).join(" ") || avvocatoId;
      if (!pec) {
        checkErrors.push(`Avvocato ${label}: PEC mancante — mail non generabile`);
      }
    } catch {
      checkErrors.push(`Avvocato ${avvocatoId}: non trovato`);
    }
  }

  if (checkErrors.length > 0) {
    throw new FlussoExportError([
      `Verifica fallita: ${checkErrors.length} problema/i su ${total} pratiche. Nessun ZIP generato.`,
      "",
      ...checkErrors,
    ]);
  }

  if (prepared.length !== total) {
    throw new FlussoExportError([
      `Verifica inconsistente: preparate ${prepared.length}/${total} pratiche. Nessun ZIP generato.`,
    ]);
  }

  // ── Phase 2: generate ─────────────────────────────────────────────────────
  const flussoRows: FlussoRow[] = [];
  const pdfZip = new JSZip();
  const exported: ExportedMediazione[] = [];

  for (let i = 0; i < prepared.length; i++) {
    const row = prepared[i];
    onStep?.({ phase: "generate", current: i + 1, total, label: row.rgm });

    try {
      const convTpl = modelliBuf[row.modelloNome];
      const adesioneTpl = modelliBuf[MODELLO_MODULO_ADESIONE];
      if (!convTpl || !adesioneTpl) {
        throw new FlussoExportError([
          `${row.rgm}: modello ${!convTpl ? row.modelloNome : MODELLO_MODULO_ADESIONE} non disponibile in generazione`,
        ]);
      }

      const convData = buildConvocazioneData({
        rgm: row.rgm,
        chiamato: row.chiamato,
        istante: row.istante,
        mediatoreName: row.mediatoreName,
        mediatoreFemale: row.mediatoreFemale,
        dataIncontro: row.dataIncontro,
        dataDeposito: row.dataDeposito,
      });
      const adesioneData = buildAdesioneData({
        rgm: row.rgm,
        chiamato: row.chiamato,
        avvocato: row.avvocatoChiamato,
        oggetto: row.oggetto,
      });

      const filledConv = await fillWordMergeFields(convTpl, convData);
      const filledAdesione = await fillWordMergeFields(adesioneTpl, adesioneData);

      const [pdfConv, pdfAdesione] = await Promise.all([
        convertDocxToPdf([filledConv]),
        convertDocxToPdf([filledAdesione]),
      ]);
      if (!pdfConv || !pdfAdesione) {
        throw new FlussoExportError([
          `${row.rgm}: conversione DOCX→PDF fallita. Nessun ZIP generato.`,
        ]);
      }

      const merged = await mergePdfs([pdfConv, row.istanzaBuf, pdfAdesione]);
      if (!merged) {
        throw new FlussoExportError([`${row.rgm}: merge PDF fallito. Nessun ZIP generato.`]);
      }

      const pdfName = `${row.mediazioneId}.pdf`;
      pdfZip.file(pdfName, merged, { compression: "STORE" });

      const ragioneSociale = soggettoDisplayName(row.chiamato);
      const indirizzo = [row.chiamato.indirizzo_riga_1, row.chiamato.numero_civico]
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .join(" ");

      flussoRows.push({
        id_lesive: row.mediazioneId,
        RagioneSociale: ragioneSociale,
        CAP: String(row.chiamato.cap ?? "").trim(),
        Citta: String(row.chiamato.comune ?? "").trim(),
        Provincia: String(row.chiamato.provincia ?? "").trim(),
        Stato: "ITALIA",
        Indirizzo: indirizzo,
        CompletamentoIndirizzo: String(row.chiamato.indirizzo_riga_2 ?? "").trim(),
        CompletamentoNominativo: row.rgm ? `(${row.rgm})` : "",
        NomeFile: pdfName,
        CodiceFiscale: "",
        Telefono: "",
        sms: "",
        testoSms: "",
        code_mittente: FLUSSO_CODE_MITTENTE,
        code_mittente_return: FLUSSO_CODE_MITTENTE,
      });

      exported.push({
        mediazioneId: row.mediazioneId,
        rgm: row.rgm,
        codiceUnivocoCliente: row.codiceUnivoco,
        dataIncontro: row.dataIncontro,
        chiamatoNome: ragioneSociale,
        oggetto: row.oggetto,
        istanteAvvocatoIds: row.istanteAvvocatoIds,
        mediatoreName: row.mediatoreName,
      });
    } catch (e) {
      if (e instanceof FlussoExportError) throw e;
      throw new FlussoExportError([
        formatCaughtError(e, row.rgm),
        "Generazione interrotta. Nessun ZIP generato.",
      ]);
    }
  }

  // ── Phase 3: mail ─────────────────────────────────────────────────────────
  const byAvvocato = new Map<string, ExportedMediazione[]>();
  for (const row of exported) {
    for (const aid of row.istanteAvvocatoIds) {
      const list = byAvvocato.get(aid) ?? [];
      list.push(row);
      byAvvocato.set(aid, list);
    }
  }

  const outer = new JSZip();
  outer.file("Flusso.csv", buildFlussoCsv(flussoRows));
  const pdfZipBuf = Buffer.from(
    await pdfZip.generateAsync({ type: "nodebuffer", compression: "STORE" }),
  );
  outer.file("_pdf.zip", pdfZipBuf);

  const avvEntries = [...byAvvocato.entries()];
  let mailCount = 0;
  const dataExportStr = new Date().toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  });
  for (let i = 0; i < avvEntries.length; i++) {
    const [avvocatoId, rows] = avvEntries[i];
    onStep?.({
      phase: "mail",
      current: i + 1,
      total: Math.max(1, avvEntries.length),
      label: avvocatoId,
    });

    const avv = avvocatiCache.get(avvocatoId);
    if (!avv) {
      throw new FlussoExportError([
        `Avvocato ${avvocatoId}: non trovato in generazione mail. Nessun ZIP generato.`,
      ]);
    }
    const pec = String(avv.pec ?? "").trim();
    const label = [avv.cognome, avv.nome].filter(Boolean).join(" ") || avvocatoId;
    if (!pec) {
      throw new FlussoExportError([
        `Avvocato ${label}: PEC mancante. Nessun ZIP generato.`,
      ]);
    }

    const xlsxRows = rows.map((r) => ({
      codiceUnivocoCliente: r.codiceUnivocoCliente,
      rgm: r.rgm,
      dataIncontro: r.dataIncontro
        ? r.dataIncontro.toLocaleString("it-IT", {
            timeZone: "Europe/Rome",
            dateStyle: "short",
            timeStyle: "short",
          })
        : "",
      mediatore: r.mediatoreName,
      dataExport: dataExportStr,
      chiamato: r.chiamatoNome,
      oggetto: r.oggetto,
    }));
    const xlsxBuf = buildAvvocatoXlsx(xlsxRows);
    const eml = buildEml({
      to: pec,
      subject: "Riscontro mediazioni depositate",
      body: "Gentile Avvocato,\r\n\r\nin allegato il riscontro delle sue mediazioni depositate.\r\n\r\nCordiali saluti",
      attachmentName: "riscontro_mediazioni.xlsx",
      attachmentBuffer: xlsxBuf,
    });
    const fileName = `${sanitizeFilePart(label) || avvocatoId}.eml`;
    outer.file(`mail_avvocati/${fileName}`, eml);
    mailCount++;
  }

  const report = [
    `PDF generati: ${flussoRows.length}/${total}`,
    `Mail avvocati: ${mailCount}`,
    "",
    "Export completato senza errori.",
  ];
  outer.file("Report.txt", report.join("\n"));

  const zip = Buffer.from(await outer.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { zip, report, okCount: flussoRows.length, mailCount };
}
