import type PocketBase from "pocketbase";
import { fillWordMergeFields } from "~/lib/docx-merge-fields.server";
import {
  MODELLI_VERBALI_NOMI,
  modelloVerbaleMetaByNome,
  modelloVerbaleNomeForEsito,
} from "~/lib/modelli-verbali";
import { normalizeEsitoFinale } from "~/lib/esito-finale";

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

type SoggettoLite = {
  tipo?: string;
  nome?: string;
  cognome?: string;
  ragione_sociale?: string;
  codice_fiscale?: string;
  piva?: string;
};

type AvvocatoLite = {
  nome?: string;
  cognome?: string;
  foro_di_appartenenza?: string;
  numero_tessera_foro?: string;
};

function partsInRome(d: Date): {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
} {
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

/** Match sample verbali stampa-unione (`11/08/2025`). */
function formatDataSlash(d: Date): string {
  const p = partsInRome(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`;
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

function soggettoCf(s: SoggettoLite | null | undefined): string {
  if (!s) return "";
  const cf = String(s.codice_fiscale ?? "").trim();
  if (cf) return cf;
  return String(s.piva ?? "").trim();
}

function avvocatoDisplay(a: AvvocatoLite | null | undefined): string {
  if (!a) return "";
  return [a.nome, a.cognome].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
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

export async function loadModelloVerbaleBuffer(
  pb: PocketBase,
  nome: string,
): Promise<{ buffer: Buffer; modelloId: string } | { error: string }> {
  const filterNome = nome.replace(/"/g, '\\"');
  const active = await pb.collection("modelli_documenti").getList(1, 1, {
    filter: `nome = "${filterNome}" && attivo = true`,
    sort: "-updated",
  });
  let modello = active.items[0] as { id: string; file?: string } | undefined;
  if (!modello) {
    const any = await pb.collection("modelli_documenti").getList(1, 1, {
      filter: `nome = "${filterNome}"`,
      sort: "-updated",
    });
    modello = any.items[0] as { id: string; file?: string } | undefined;
  }
  if (!modello?.file) {
    return {
      error: `Modello "${nome}" mancante o senza file. Caricalo in Impostazioni → Modelli.`,
    };
  }
  const buffer = await fetchPbFileBuffer(pb, modello, String(modello.file));
  if (!buffer) {
    return { error: `Impossibile scaricare il modello "${nome}".` };
  }
  return { buffer, modelloId: modello.id };
}

export function resolveModelloVerbaleNome(opts: {
  modello?: string | null;
  esito?: string | null;
}): { nome: string } | { error: string } {
  const requested = String(opts.modello ?? "").trim();
  if (requested) {
    if (!modelloVerbaleMetaByNome(requested) && !MODELLI_VERBALI_NOMI.includes(requested)) {
      return { error: `Modello verbale non riconosciuto: "${requested}".` };
    }
    return { nome: requested };
  }
  const esito = normalizeEsitoFinale(String(opts.esito ?? "").trim());
  if (!esito) {
    return {
      error:
        "Seleziona un modello di verbale oppure imposta l'esito finale della mediazione.",
    };
  }
  const nome = modelloVerbaleNomeForEsito(esito);
  if (!nome) {
    return { error: `Nessun modello verbale per l'esito "${esito}".` };
  }
  return { nome };
}

export function buildVerbaleMergeData(opts: {
  mediazione: Record<string, unknown>;
  mediatoreName: string;
  istante: SoggettoLite | null;
  chiamato: SoggettoLite | null;
  avvIstante: AvvocatoLite | null;
  avvChiamato: AvvocatoLite | null;
  incontroDate: Date | null;
}): Record<string, string> {
  const { mediazione, mediatoreName, istante, chiamato, avvIstante, avvChiamato, incontroDate } =
    opts;

  const oggettoRaw = String(mediazione.oggetto ?? "").trim();
  const materiaAltro = String(mediazione.materia_altro ?? "").trim();
  const oggetto =
    oggettoRaw.toLowerCase() === "altro" && materiaAltro ? materiaAltro : oggettoRaw;

  const deposito =
    parsePbDate(mediazione.data_deposito) ?? parsePbDate(mediazione.data_protocollo);

  const p = incontroDate ? partsInRome(incontroDate) : null;
  const isChiamatoGiuridica = String(chiamato?.tipo ?? "") === "Giuridica";

  return {
    RGM: String(mediazione.rgm ?? "").trim(),
    COMPETENZA: String(mediazione.competenza ?? "").trim(),
    VALORE: String(mediazione.valore ?? "").trim(),
    OGGETTO: oggetto,
    ANNO: p ? String(p.year) : "",
    GIORNO: p ? String(p.day) : "",
    MESE: p ? MONTHS_IT[p.month - 1] : "",
    ORE: p
      ? `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
      : "",
    MEDIATORE: mediatoreName.trim(),
    DATA_DEPOSITO: deposito ? formatDataSlash(deposito) : "",
    ISTANTE: soggettoDisplayName(istante),
    CF_ISTANTE: soggettoCf(istante),
    AVV_ISTANTE: avvocatoDisplay(avvIstante),
    Foro_: String(avvIstante?.foro_di_appartenenza ?? "").trim(),
    Tessera: String(avvIstante?.numero_tessera_foro ?? "").trim(),
    NOME_CHIAMATO: isChiamatoGiuridica ? "" : String(chiamato?.nome ?? "").trim(),
    COGNOME_CHIAMATO: isChiamatoGiuridica
      ? String(chiamato?.ragione_sociale ?? "").trim()
      : String(chiamato?.cognome ?? "").trim(),
    CF_CHIAMATO: soggettoCf(chiamato),
    AVV_CHIAMATO: avvocatoDisplay(avvChiamato),
    Foro_Chiamato: String(avvChiamato?.foro_di_appartenenza ?? "").trim(),
    Tessera_Chiamato: String(avvChiamato?.numero_tessera_foro ?? "").trim(),
  };
}

function asId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "id" in value) {
    return String((value as { id: string }).id);
  }
  return "";
}

/**
 * Build filled verbale DOCX for a mediazione.
 */
export async function generateVerbaleDocx(
  pb: PocketBase,
  mediazioneId: string,
  opts?: { modello?: string | null; incontroId?: string | null },
): Promise<{ buffer: Buffer; filename: string; modelloNome: string } | { error: string }> {
  let mediazione: Record<string, unknown>;
  try {
    mediazione = (await pb.collection("mediazioni").getOne(mediazioneId, {
      expand: "mediatore",
    })) as Record<string, unknown>;
  } catch {
    return { error: "Mediazione non trovata." };
  }

  const resolved = resolveModelloVerbaleNome({
    modello: opts?.modello,
    esito: String(mediazione.esito_finale ?? ""),
  });
  if ("error" in resolved) return resolved;

  const loaded = await loadModelloVerbaleBuffer(pb, resolved.nome);
  if ("error" in loaded) return loaded;

  const partecipazioni = await pb.collection("partecipazioni").getFullList({
    filter: `mediazione = "${mediazioneId}"`,
  });

  const soggettoIds = [
    ...new Set(
      partecipazioni
        .map((p) => asId((p as { soggetto?: unknown }).soggetto))
        .filter(Boolean),
    ),
  ];
  const avvocatoIds = [
    ...new Set(
      partecipazioni.flatMap((p) => {
        const raw = (p as { avvocati?: unknown }).avvocati;
        const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
        return ids.map((id) => asId(id)).filter(Boolean);
      }),
    ),
  ];

  const [soggetti, avvocati, incontri] = await Promise.all([
    soggettoIds.length
      ? pb.collection("soggetti").getFullList({
          filter: soggettoIds.map((id) => `id = "${id}"`).join(" || "),
        })
      : Promise.resolve([]),
    avvocatoIds.length
      ? pb.collection("avvocati").getFullList({
          filter: avvocatoIds.map((id) => `id = "${id}"`).join(" || "),
        })
      : Promise.resolve([]),
    pb.collection("incontri").getFullList({
      filter: `mediazione = "${mediazioneId}"`,
      sort: "-data_programmazione",
    }),
  ]);

  const soggettiById = Object.fromEntries(
    (soggetti as Record<string, unknown>[]).map((s) => [String(s.id), s]),
  );
  const avvocatiById = Object.fromEntries(
    (avvocati as Record<string, unknown>[]).map((a) => [String(a.id), a]),
  );

  const firstParte = (ruolo: string) =>
    partecipazioni.find(
      (p) => String((p as { istante_o_chiamato?: string }).istante_o_chiamato) === ruolo,
    ) as
      | { soggetto?: unknown; avvocati?: unknown }
      | undefined;

  const istantePart = firstParte("Istante");
  const chiamatoPart = firstParte("Chiamato");

  const istante = istantePart
    ? (soggettiById[asId(istantePart.soggetto)] as SoggettoLite | undefined) ?? null
    : null;
  const chiamato = chiamatoPart
    ? (soggettiById[asId(chiamatoPart.soggetto)] as SoggettoLite | undefined) ?? null
    : null;

  const firstAvv = (part: { avvocati?: unknown } | undefined): AvvocatoLite | null => {
    if (!part) return null;
    const raw = part.avvocati;
    const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(asId).filter(Boolean);
    const id = ids[0];
    if (!id) return null;
    return (avvocatiById[id] as AvvocatoLite | undefined) ?? null;
  };

  let incontro =
    opts?.incontroId
      ? (incontri as Record<string, unknown>[]).find((i) => String(i.id) === opts.incontroId)
      : (incontri as Record<string, unknown>[])[0];

  const incontroDate =
    parsePbDate(incontro?.data_inizio_effettiva) ??
    parsePbDate(incontro?.data_programmazione);

  const expand = mediazione.expand as Record<string, unknown> | undefined;
  const mediatore = expand?.mediatore as { name?: string } | undefined;
  const mediatoreName = String(mediatore?.name ?? "").trim();

  const data = buildVerbaleMergeData({
    mediazione,
    mediatoreName,
    istante,
    chiamato,
    avvIstante: firstAvv(istantePart),
    avvChiamato: firstAvv(chiamatoPart),
    incontroDate,
  });

  const filled = await fillWordMergeFields(loaded.buffer, data);
  const rgm = String(mediazione.rgm ?? "").trim().replace(/[^\w.-]+/g, "_") || mediazioneId;
  const safeNome = resolved.nome.replace(/[^\w.-]+/g, "_");
  const filename = `${safeNome}_RGM_${rgm}.docx`;

  return { buffer: filled, filename, modelloNome: resolved.nome };
}
