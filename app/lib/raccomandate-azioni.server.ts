import type PocketBase from "pocketbase";
import {
  AZIONE_RACCOMANDATA_LABELS,
  ESITI_RACCOMANDATA_MANCATA_CONSEGNA,
  ESITI_RACCOMANDATA_VERBALE_NR,
  joinEsitoRaccomandata,
  type AzioneRaccomandata,
} from "~/lib/esito-finale";

export const MODELLO_MANCATA_CONSEGNA_NOME = "Comunicazione mancata consegna";

const LETTERA_MANCATA_CONSEGNA_TEXT = `Egr. Avv.

con la presente per informarla che la domanda di mediazione è stata restituita al mittente in quanto non consegnata e pertanto la procedura di mediazione non può ritenersi validamente conclusa.

Restiamo, dunque, in attesa di sue cortesi determinazioni in ordine ad una, eventuale, ulteriore convocazione da trasmettere alla parte previa indicazione delle informazioni corrette.

In caso contrario, entro 5 gg. dalla presente, provvederemo alla chiusura d'ufficio del procedimento.

Cordialità,


La Segreteria

--

Riconciliamo S.r.l.s., Via Antonio Bertoloni n. 27 - 00197 - Roma RM
`;

function isPastMeeting(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}

export function classifyAzioneRaccomandata(opts: {
  esitoRaccomandata: string;
  adesione: boolean;
  /** Se presente, ha priorità sul bool adesione */
  statoAdesione?: string | null;
  meetingIso?: string | null;
}): AzioneRaccomandata | null {
  const esito = opts.esitoRaccomandata.trim();
  if (!esito) return null;

  if ((ESITI_RACCOMANDATA_MANCATA_CONSEGNA as readonly string[]).includes(esito)) {
    return "comunicazione_mancata_consegna";
  }

  if ((ESITI_RACCOMANDATA_VERBALE_NR as readonly string[]).includes(esito)) {
    const hasAdesione =
      opts.statoAdesione != null && String(opts.statoAdesione).trim() !== ""
        ? String(opts.statoAdesione).trim() === "adesione"
        : opts.adesione;
    if (!hasAdesione && isPastMeeting(opts.meetingIso)) {
      return "verbale_nessuna_risposta";
    }
  }

  return null;
}

async function latestIncontroIso(pb: PocketBase, mediazioneId: string): Promise<string | null> {
  try {
    const list = await pb.collection("incontri").getList(1, 1, {
      filter: `mediazione = "${mediazioneId}"`,
      sort: "-data_programmazione",
      fields: "data_programmazione",
      requestKey: null,
    });
    const iso = list.items[0]?.data_programmazione;
    return iso ? String(iso) : null;
  } catch {
    return null;
  }
}

async function notifyManagers(
  pb: PocketBase,
  mediazioneId: string,
  rgm: string,
  azione: AzioneRaccomandata,
  attoreId?: string,
) {
  try {
    const managers = await pb.collection("users").getFullList({
      filter: 'ruolo_corrente = "admin" || ruolo_corrente = "manager" || ruoli ?~ "admin" || ruoli ?~ "manager"',
      fields: "id",
      requestKey: null,
    });
    const label = AZIONE_RACCOMANDATA_LABELS[azione];
    const messaggio =
      azione === "verbale_nessuna_risposta"
        ? `Da fare: verbale Nessuna Risposta${rgm ? ` (RGM ${rgm})` : ""}.`
        : `Da fare: comunicazione mancata consegna${rgm ? ` (RGM ${rgm})` : ""}.`;

    for (const u of managers) {
      if (attoreId && u.id === attoreId) continue;
      await pb.collection("notifiche").create({
        destinatario: u.id,
        attore: attoreId || undefined,
        tipo: "azione_raccomandata",
        messaggio,
        dettaglio: label,
        mediazioni: [mediazioneId],
        count: 1,
        letto: false,
      }).catch(() => undefined);
    }
  } catch {
    // non-blocking
  }
}

/**
 * Generate a plain-text/PDF-friendly .txt document for mancata consegna when no DOCX modello exists.
 * If a modelli_documenti entry named "Comunicazione mancata consegna" exists with a .docx file,
 * we still attach a generated text body as fallback (docx merge would need placeholders).
 */
async function attachComunicazioneMancataConsegna(
  pb: PocketBase,
  mediazioneId: string,
  rgm: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const body = LETTERA_MANCATA_CONSEGNA_TEXT;
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const file = new File(
      [blob],
      `comunicazione-mancata-consegna${rgm ? `-${rgm.replace(/[^\w.-]+/g, "_")}` : ""}.txt`,
      { type: "text/plain" },
    );
    const form = new FormData();
    form.append("mediazione", mediazioneId);
    form.append("tipo", "Comunicazione mancata consegna");
    form.append(
      "descrizione",
      `Generata automaticamente da esito raccomandata${rgm ? ` — RGM ${rgm}` : ""}`,
    );
    form.append("file", file, file.name);
    await pb.collection("documenti").create(form);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "errore generazione lettera",
    };
  }
}

/**
 * Evaluate raccomandata esito after create/update and flag mediazione + notify + letter.
 */
export async function processAzioneRaccomandata(opts: {
  pb: PocketBase;
  mediazioneId: string;
  statoRaccomandata?: string | null;
  motivoRaccomandata?: string | null;
  attoreId?: string;
}): Promise<{ azione: AzioneRaccomandata | null; letterOk?: boolean; letterError?: string }> {
  const { pb, mediazioneId } = opts;
  const esito = joinEsitoRaccomandata(opts.statoRaccomandata, opts.motivoRaccomandata);
  if (!esito) return { azione: null };

  let mediazione: Record<string, unknown>;
  try {
    mediazione = (await pb.collection("mediazioni").getOne(mediazioneId)) as unknown as Record<
      string,
      unknown
    >;
  } catch {
    return { azione: null };
  }

  if (mediazione.is_deleted) return { azione: null };

  const meetingIso = await latestIncontroIso(pb, mediazioneId);
  const azione = classifyAzioneRaccomandata({
    esitoRaccomandata: esito,
    adesione: Boolean(mediazione.adesione),
    statoAdesione: String(mediazione.stato_adesione ?? ""),
    meetingIso,
  });

  if (!azione) return { azione: null };

  const prev = String(mediazione.azione_raccomandata ?? "");
  const prevStato = String(mediazione.azione_raccomandata_stato ?? "");
  // Don't downgrade an open action of a different type if already da_fare with letter generated
  if (prev === azione && prevStato === "da_fare") {
    return { azione };
  }

  const rgm = String(mediazione.rgm ?? "");
  const nota = `${AZIONE_RACCOMANDATA_LABELS[azione]} — esito raccomandata: ${esito}`;

  await pb.collection("mediazioni").update(mediazioneId, {
    azione_raccomandata: azione,
    azione_raccomandata_stato: "da_fare",
    azione_raccomandata_nota: nota,
  });

  await notifyManagers(pb, mediazioneId, rgm, azione, opts.attoreId);

  let letterOk: boolean | undefined;
  let letterError: string | undefined;
  if (azione === "comunicazione_mancata_consegna") {
    const res = await attachComunicazioneMancataConsegna(pb, mediazioneId, rgm);
    letterOk = res.ok;
    letterError = res.error;
  }

  return { azione, letterOk, letterError };
}

export { LETTERA_MANCATA_CONSEGNA_TEXT };
