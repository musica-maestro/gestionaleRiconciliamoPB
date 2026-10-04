/**
 * Server-side logic for importing mediazioni from Excel (Tracciato Organismo format).
 * Parses rows and creates mediazioni, soggetti, avvocati, partecipazioni in PocketBase.
 */
import type PocketBase from "pocketbase";
import { resolveCompetenzaNome } from "~/lib/competenza";
import { normalizeCodiceFiscale, parseDateToISO } from "~/lib/import-mediazioni-mapping";
import type { ImportParte, ImportRow } from "~/lib/import-mediazioni-mapping";

export type { ImportRow } from "~/lib/import-mediazioni-mapping";

export const IMPORT_ROW_HEADERS = [
  "RGM",
  "Registro num.",
  "Mediatore",
  "Materia",
  "Valore",
  "Competenza",
  "Modalità",
  "Data deposito",
  "Data incontro",
  "Ora incontro",
  "Nome e cognome Istante",
  "Cognome Istante",
  "CF Istante",
  "Nome e cognome Avv",
  "CF Avvocato",
  "PEC Avv",
  "Recapito Telefonico Avv.",
  "Indirizzo avvocato",
  "Nome Chiamato",
  "Cognome Chiamato",
  "CF Chiamato",
  "Indirizzo1",
  "Riga 2",
  "Numero civico",
  "Comune",
  "Provincia",
  "CAP",
  "Link Istanza",
  "Link Cartella",
];

function buildSoggettoIndirizzo(indirizzo: string): {
  indirizzo_riga_1?: string;
  indirizzo_riga_2?: string;
  numero_civico?: string;
  comune?: string;
  provincia?: string;
  cap?: string;
} {
  if (!indirizzo) return {};
  const parts = indirizzo.split(",").map((p) => p.trim());
  return {
    indirizzo_riga_1: parts[0] || undefined,
    indirizzo_riga_2: parts[1] || undefined,
    numero_civico: parts[2] || undefined,
    comune: parts[3] || undefined,
    provincia: parts[4] || undefined,
    cap: parts[5] || undefined,
  };
}

function isUrlLike(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && (t.startsWith("http://") || t.startsWith("https://"));
}

async function upsertDocumentoLink(
  pb: PocketBase,
  mediazioneId: string,
  tipoId: string | undefined,
  linkRaw: string | undefined,
  descrizione: string
): Promise<void> {
  const link = (linkRaw || "").trim();
  if (!tipoId || !isUrlLike(link)) return;
  const existing = await pb
    .collection("documenti")
    .getFullList({
      filter: pb.filter("mediazione = {:m} && tipo = {:t}", { m: mediazioneId, t: tipoId }),
      limit: 1,
      fields: "id,link_legacy",
    })
    .catch(() => []);
  if (existing.length > 0) {
    const doc = existing[0] as { id: string; link_legacy?: string };
    if (doc.link_legacy !== link) {
      await pb.collection("documenti").update(doc.id, { link_legacy: link });
    }
    return;
  }
  await pb.collection("documenti").create({
    mediazione: mediazioneId,
    tipo: tipoId,
    descrizione,
    link_legacy: link,
  });
}

/** Build data_programmazione UTC from date (qualsiasi formato supportato da parseDateToISO) e ora (HH:MM o H.MM) in Europe/Rome.
 * Se manca l'ora, usa 00:00 (Excel spesso ha solo la data incontro). */
function buildDataProgrammazioneUTC(dateStr: string, timeStr: string): string | undefined {
  const dateNorm = parseDateToISO(dateStr);
  if (!dateNorm) return undefined;
  const timeNorm = (timeStr?.trim() || "00:00").replace(".", ":");
  const [y, mo, d] = dateNorm.split("-").map(Number);
  const [h, mi] = timeNorm.split(":").map(Number);
  if (isNaN(y) || isNaN(mo) || isNaN(d) || isNaN(h) || isNaN(mi)) return undefined;
  const approxEpoch = Date.UTC(y, mo - 1, d, h, mi, 0);
  const epochFromParts = (epoch: number, tz: string): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(new Date(epoch));
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");
    const fh = get("hour");
    return Date.UTC(get("year"), get("month") - 1, get("day"), fh >= 24 ? 0 : fh, get("minute"), get("second"));
  };
  const offsetMs = epochFromParts(approxEpoch, "Europe/Rome") - epochFromParts(approxEpoch, "UTC");
  return new Date(approxEpoch - offsetMs).toISOString().replace("T", " ").slice(0, 19) + ".000Z";
}

type AddrFields = {
  indirizzo_riga_1?: string;
  indirizzo_riga_2?: string;
  numero_civico?: string;
  comune?: string;
  provincia?: string;
  cap?: string;
};

/** Find soggetto by CF, P.IVA, ragione sociale, or nome+cognome. Avoid clones. */
async function findOrCreateSoggetto(
  pb: PocketBase,
  parte: { nome: string; cognome: string; codice_fiscale: string },
  addrFields: AddrFields,
  opts?: { preferGiuridica?: boolean; fullName?: string }
): Promise<string> {
  const cf = normalizeCodiceFiscale(parte.codice_fiscale);
  const full = (opts?.fullName || [parte.nome, parte.cognome].filter(Boolean).join(" ")).trim();
  const giuridicaHint = /\b(s\.?\s?r\.?\s?l\.?|s\.?\s?p\.?\s?a\.?|srl|spa|snc|sas|societ)/i.test(full);
  const giuridica = Boolean(opts?.preferGiuridica || giuridicaHint);

  if (cf) {
    const existing = await pb
      .collection("soggetti")
      .getFullList({
        filter: pb.filter("codice_fiscale = {:cf}", { cf }),
        limit: 1,
        fields: "id,nome,cognome,codice_fiscale,ragione_sociale,indirizzo_riga_1,indirizzo_riga_2,numero_civico,comune,provincia,cap",
      })
      .catch(() => []);
    if (existing.length > 0) {
      return patchSoggetto(pb, existing[0] as Record<string, unknown>, parte, addrFields);
    }
  }

  if (giuridica && full) {
    const existingRs = await pb
      .collection("soggetti")
      .getFullList({
        filter: pb.filter("ragione_sociale = {:rs}", { rs: full }),
        limit: 1,
        fields: "id,nome,cognome,codice_fiscale,ragione_sociale,indirizzo_riga_1,indirizzo_riga_2,numero_civico,comune,provincia,cap",
      })
      .catch(() => []);
    if (existingRs.length > 0) {
      return patchSoggetto(pb, existingRs[0] as Record<string, unknown>, parte, addrFields);
    }
  }

  const nome = (parte.nome || "").trim();
  const cognome = (parte.cognome || "").trim();
  if (nome && cognome) {
    const existingName = await pb
      .collection("soggetti")
      .getFullList({
        filter: pb.filter("nome = {:n} && cognome = {:c}", { n: nome, c: cognome }),
        limit: 1,
        fields: "id,nome,cognome,codice_fiscale,ragione_sociale,indirizzo_riga_1,indirizzo_riga_2,numero_civico,comune,provincia,cap",
      })
      .catch(() => []);
    if (existingName.length > 0) {
      return patchSoggetto(pb, existingName[0] as Record<string, unknown>, parte, addrFields);
    }
  }

  const payload: Record<string, unknown> = {
    ...addrFields,
  };
  if (giuridica) {
    payload.tipo = "Giuridica";
    payload.ragione_sociale = full || undefined;
    if (cf.length === 11) payload.piva = cf;
  } else {
    payload.tipo = "Fisica";
    payload.nome = parte.nome || undefined;
    payload.cognome = parte.cognome || undefined;
  }
  if (cf) payload.codice_fiscale = cf;
  const created = await pb.collection("soggetti").create(payload);
  return created.id;
}

async function patchSoggetto(
  pb: PocketBase,
  s: Record<string, unknown>,
  parte: { nome: string; cognome: string; codice_fiscale: string },
  addrFields: AddrFields
): Promise<string> {
  const id = s.id as string;
  const updates: Record<string, unknown> = {};
  const excelCf = normalizeCodiceFiscale(parte.codice_fiscale);
  if (excelCf && !normalizeCodiceFiscale(s.codice_fiscale as string)) {
    updates.codice_fiscale = excelCf;
  }
  if (!(s.nome as string)?.trim() && parte.nome) updates.nome = parte.nome;
  if (!(s.cognome as string)?.trim() && parte.cognome) updates.cognome = parte.cognome;
  if (!(s.indirizzo_riga_1 as string)?.trim() && addrFields.indirizzo_riga_1) updates.indirizzo_riga_1 = addrFields.indirizzo_riga_1;
  if (!(s.indirizzo_riga_2 as string)?.trim() && addrFields.indirizzo_riga_2) updates.indirizzo_riga_2 = addrFields.indirizzo_riga_2;
  if (!(s.numero_civico as string)?.trim() && addrFields.numero_civico) updates.numero_civico = addrFields.numero_civico;
  if (!(s.comune as string)?.trim() && addrFields.comune) updates.comune = addrFields.comune;
  if (!(s.provincia as string)?.trim() && addrFields.provincia) updates.provincia = addrFields.provincia;
  if (!(s.cap as string)?.trim() && addrFields.cap) updates.cap = addrFields.cap;
  if (Object.keys(updates).length > 0) {
    await pb.collection("soggetti").update(id, updates);
  }
  return id;
}

/** Riusa l'avvocato esistente (CF, poi nome+cognome) invece di crearne uno nuovo a ogni import. */
async function findOrCreateAvvocato(
  pb: PocketBase,
  avv: ImportRow["avvocatoIstante"]
): Promise<string | undefined> {
  const nome = (avv.nome || "").trim();
  const cognome = (avv.cognome || "").trim();
  const cf = normalizeCodiceFiscale(avv.codice_fiscale);
  if (!nome && !cognome && !cf) return undefined;

  const filters: string[] = [];
  if (cf) filters.push(pb.filter("codice_fiscale = {:cf}", { cf }));
  if (nome || cognome) filters.push(pb.filter("nome = {:n} && cognome = {:c}", { n: nome, c: cognome }));
  for (const filter of filters) {
    const found = await pb
      .collection("avvocati")
      .getFirstListItem(filter, { fields: "id" })
      .catch(() => null);
    if (found) return found.id;
  }

  const created = await pb.collection("avvocati").create({
    nome: nome || undefined,
    cognome: cognome || undefined,
    codice_fiscale: cf || undefined,
    pec: avv.pec,
    telefono: avv.telefono,
    indirizzo: avv.indirizzo,
  });
  return created.id;
}

type ExistingParte = {
  id: string;
  istante_o_chiamato?: string;
  avvocati?: string[];
  expand?: { soggetto?: Record<string, unknown> };
};

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function soggettoFullName(s: Record<string, unknown>): string {
  const rs = String(s.ragione_sociale ?? "").trim();
  if (rs) return rs;
  return [s.nome, s.cognome].filter(Boolean).join(" ");
}

function hasParteData(p: ImportParte | undefined): p is ImportParte {
  return Boolean(p && (p.nome || p.cognome || p.codice_fiscale));
}

function partiFromRow(row: ImportRow, ruolo: "Istante" | "Chiamato"): ImportParte[] {
  const list = ruolo === "Istante" ? row.istanti : row.chiamati;
  if (list && list.length > 0) return list.filter(hasParteData);
  const single = ruolo === "Istante" ? row.parteIstante : row.parteChiamato;
  return hasParteData(single as ImportParte) ? [single as ImportParte] : [];
}

/**
 * Parti esistenti: non si aggiungono/rimuovono partecipazioni, ma si corregge il CF
 * dei soggetti già collegati quando in DB è vuoto/non valido ("nd", troncato, …).
 */
async function repairExistingParti(
  pb: PocketBase,
  existing: ExistingParte[],
  excelParti: ImportParte[]
): Promise<void> {
  const soggetti = existing
    .map((p) => p.expand?.soggetto)
    .filter((s): s is Record<string, unknown> => Boolean(s));
  if (soggetti.length === 0) return;

  for (const parte of excelParti) {
    const cf = normalizeCodiceFiscale(parte.codice_fiscale);
    if (!cf) continue;
    if (soggetti.some((s) => normalizeCodiceFiscale(s.codice_fiscale as string) === cf)) continue;
    const key = normName(parte.full || [parte.nome, parte.cognome].join(" "));
    let target = soggetti.find((s) => normName(soggettoFullName(s)) === key);
    if (!target && soggetti.length === 1 && excelParti.length === 1) target = soggetti[0];
    if (target && !normalizeCodiceFiscale(target.codice_fiscale as string)) {
      await pb.collection("soggetti").update(target.id as string, { codice_fiscale: cf });
      target.codice_fiscale = cf;
    }
  }
}

async function ensurePartecipazioniFromExcel(
  pb: PocketBase,
  mediazioneId: string,
  row: ImportRow
): Promise<void> {
  const existingParti = (await pb
    .collection("partecipazioni")
    .getFullList({
      filter: pb.filter("mediazione = {:m}", { m: mediazioneId }),
      expand: "soggetto",
      fields: "id,istante_o_chiamato,avvocati,expand.soggetto.id,expand.soggetto.nome,expand.soggetto.cognome,expand.soggetto.ragione_sociale,expand.soggetto.codice_fiscale",
    })
    .catch(() => [])) as unknown as ExistingParte[];
  const istantiDb = existingParti.filter((p) => p.istante_o_chiamato === "Istante");
  const chiamatiDb = existingParti.filter((p) => p.istante_o_chiamato === "Chiamato");

  const istantiXl = partiFromRow(row, "Istante");
  const chiamatiXl = partiFromRow(row, "Chiamato");
  const avvocatoId = await findOrCreateAvvocato(pb, row.avvocatoIstante);

  if (istantiDb.length > 0) {
    await repairExistingParti(pb, istantiDb, istantiXl);
    if (avvocatoId) {
      for (const p of istantiDb) {
        if (!p.avvocati || p.avvocati.length === 0) {
          await pb.collection("partecipazioni").update(p.id, { avvocati: [avvocatoId] });
        }
      }
    }
  } else {
    for (const parte of istantiXl) {
      const soggettoId = await findOrCreateSoggetto(pb, parte, {}, { fullName: parte.full });
      await pb.collection("partecipazioni").create({
        mediazione: mediazioneId,
        soggetto: soggettoId,
        istante_o_chiamato: "Istante",
        avvocati: avvocatoId ? [avvocatoId] : undefined,
      });
    }
  }

  if (chiamatiDb.length > 0) {
    await repairExistingParti(pb, chiamatiDb, chiamatiXl);
  } else {
    const addrChiamato: AddrFields = {
      indirizzo_riga_1: row.parteChiamato.indirizzo_riga_1 || undefined,
      indirizzo_riga_2: row.parteChiamato.indirizzo_riga_2 || undefined,
      numero_civico: row.parteChiamato.numero_civico || undefined,
      comune: row.parteChiamato.comune || undefined,
      provincia: row.parteChiamato.provincia || undefined,
      cap: row.parteChiamato.cap || undefined,
    };
    for (const [i, parte] of chiamatiXl.entries()) {
      // L'indirizzo del tracciato si riferisce solo al primo chiamato.
      const soggettoId = await findOrCreateSoggetto(pb, parte, i === 0 ? addrChiamato : {}, {
        fullName: parte.full,
      });
      await pb.collection("partecipazioni").create({
        mediazione: mediazioneId,
        soggetto: soggettoId,
        istante_o_chiamato: "Chiamato",
      });
    }
  }
}

/** "YYYY-MM-DD" e "HH:MM" in Europe/Rome per un datetime PocketBase (UTC). */
function romeParts(utc: string): { date: string; time: string } | null {
  const d = new Date(utc.replace(" ", "T"));
  if (isNaN(d.getTime())) return null;
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  const [date, time] = s.split(" ");
  return { date, time };
}

/**
 * Stesso flusso della scheda mediazione: con un incontro si passa a "Da convocare";
 * con una convocazione registrata o un incontro già passato (convocato fuori dal gestionale) → "Aperte".
 */
async function advanceStatoFromIncontri(pb: PocketBase, mediazioneId: string): Promise<void> {
  const m = await pb
    .collection("mediazioni")
    .getOne(mediazioneId, { fields: "id,stato" })
    .catch(() => null);
  const stato = String(m?.stato ?? "");
  if (stato !== "assegnata" && stato !== "da_notificare" && stato !== "pianificata") return;

  const hasConvocazione = await pb
    .collection("convocazioni")
    .getList(1, 1, { filter: pb.filter("partecipazione.mediazione = {:m}", { m: mediazioneId }), fields: "id" })
    .then((r) => r.totalItems > 0)
    .catch(() => false);
  const incontri = await pb
    .collection("incontri")
    .getList(1, 1, { filter: pb.filter("mediazione = {:m}", { m: mediazioneId }), sort: "data_programmazione", fields: "id,data_programmazione" })
    .catch(() => null);
  const first = incontri?.items[0] as { data_programmazione?: string } | undefined;
  const firstPast = first?.data_programmazione
    ? new Date(first.data_programmazione.replace(" ", "T")).getTime() < Date.now()
    : false;

  let next = stato;
  if (hasConvocazione || firstPast) next = "aperta";
  else if (first && stato === "assegnata") next = "da_notificare";
  if (next !== stato) {
    await pb.collection("mediazioni").update(mediazioneId, { stato: next });
  }
}

export async function importRows(
  pb: PocketBase,
  rows: ImportRow[],
  _userId: string,
  userNameToId: Record<string, string>
): Promise<{ success: number; errors: { index: number; error: string }[] }> {
  const errors: { index: number; error: string }[] = [];
  let success = 0;

  const tipiList = await pb.collection("documenti_tipi").getFullList({ fields: "id,nome" }).catch(() => []);
  const tipoByName: Record<string, string> = {};
  for (const t of tipiList as { id: string; nome: string }[]) {
    if (t.nome) tipoByName[t.nome] = t.id;
  }
  const tipoCartella = tipoByName["Cartella"];
  const tipoRichiesta = tipoByName["Richiesta di Mediazione"] || tipoByName["Istanza"];
  const tipoAdesione = tipoByName["Adesione Chiamato"];
  const tipoChiusura =
    tipoByName["Verbale finale"] ||
    tipoByName["Verbale Definitivo"] ||
    tipoByName["Verbale"];

  const competenzeOpzioni = await pb
    .collection("competenza_opzioni")
    .getFullList<{ nome: string; attivo?: boolean }>({ filter: "attivo = true" })
    .catch(() => [] as { nome: string; attivo?: boolean }[]);

  for (const row of rows) {
    try {
      // Only set mediatore when Excel has a resolvable name — never default to importer.
      const mediatoreName = (row.mediazionePayload.mediatore || "").trim();
      const mediatoreKey = mediatoreName.toLowerCase().replace(/\s+/g, " ");
      const mediatoreId =
        (mediatoreName && userNameToId[mediatoreName]) ||
        (mediatoreKey && userNameToId[mediatoreKey]) ||
        undefined;
      const isCheck = row.sourceFormat === "check";
      const stato = mediatoreId ? "assegnata" : "registrata";

      const mediazioneData: Record<string, unknown> = {
        rgm: row.mediazionePayload.rgm || undefined,
        ...(row.mediazionePayload.oggetto
          ? { oggetto: row.mediazionePayload.oggetto }
          : {}),
        ...(row.mediazionePayload.valore
          ? { valore: row.mediazionePayload.valore }
          : {}),
        ...(row.mediazionePayload.competenza
          ? {
              competenza: resolveCompetenzaNome(
                row.mediazionePayload.competenza,
                competenzeOpzioni,
              ),
            }
          : {}),
        ...(row.mediazionePayload.modalita_mediazione
          ? { modalita_mediazione: row.mediazionePayload.modalita_mediazione }
          : {}),
        ...(row.mediazionePayload.motivazione_deposito
          ? { motivazione_deposito: row.mediazionePayload.motivazione_deposito }
          : {}),
        ...(row.mediazionePayload.modalita_convocazione
          ? { modalita_convocazione: row.mediazionePayload.modalita_convocazione }
          : {}),
        ...(row.mediazionePayload.nota ? { nota: row.mediazionePayload.nota } : {}),
        ...(row.mediazionePayload.data_deposito
          ? { data_deposito: row.mediazionePayload.data_deposito }
          : {}),
        ...(row.mediazionePayload.data_protocollo
          ? { data_protocollo: row.mediazionePayload.data_protocollo }
          : {}),
        ...(row.mediazionePayload.esito_finale_set
          ? { esito_finale: row.mediazionePayload.esito_finale || "" }
          : row.mediazionePayload.esito_finale
            ? { esito_finale: row.mediazionePayload.esito_finale }
            : {}),
        ...(row.mediazionePayload.data_chiusura_set
          ? { data_chiusura: row.mediazionePayload.data_chiusura || null }
          : row.mediazionePayload.data_chiusura
            ? { data_chiusura: row.mediazionePayload.data_chiusura }
            : {}),
        ...(row.mediazionePayload.trasmessa_set
          ? { trasmessa: Boolean(row.mediazionePayload.trasmessa) }
          : {}),
        ...(isUrlLike(row.mediazionePayload.link_adesione || "")
          ? { adesione: true, stato_adesione: "adesione" }
          : {}),
        // Check: non azzerare mediatore se non risolto; Tracciato: comportamento precedente
        ...(mediatoreId
          ? { mediatore: mediatoreId, stato }
          : isCheck
            ? {}
            : { mediatore: "", stato }),
      };

      let mediazioneId!: string;
      let isUpdate = false;
      if (row.mediazionePayload.rgm) {
        const existing = await pb
          .collection("mediazioni")
          .getFullList({
            filter: pb.filter("rgm = {:rgm} && is_deleted != true", { rgm: row.mediazionePayload.rgm }),
            sort: "created",
            limit: 1,
          })
          .catch(() => []);
        if (existing.length > 0) {
          const cur = existing[0] as { id: string; stato?: string };
          // Non far tornare indietro il flusso (da_notificare / pianificata / aperta → assegnata).
          if (mediazioneData.stato && !["", "registrata", "assegnata"].includes(cur.stato ?? "")) {
            delete mediazioneData.stato;
          }
          await pb.collection("mediazioni").update(cur.id, mediazioneData);
          mediazioneId = cur.id;
          isUpdate = true;
        }
      }
      if (!isUpdate) {
        if (!mediazioneData.stato) {
          mediazioneData.stato = mediatoreId ? "assegnata" : "registrata";
        }
        const created = await pb.collection("mediazioni").create(mediazioneData);
        mediazioneId = created.id;
      }

      // Parti: crea solo se mancanti. Se Istante/Chiamato già in DB → non toccarli.
      await ensurePartecipazioniFromExcel(pb, mediazioneId, row);

      // Documenti: upsert link (istanza, cartella, adesione, chiusura)
      await upsertDocumentoLink(pb, mediazioneId, tipoRichiesta, row.mediazionePayload.link_istanza, "Richiesta di mediazione (import)");
      await upsertDocumentoLink(pb, mediazioneId, tipoCartella, row.mediazionePayload.link_cartella, "Cartella (import)");
      await upsertDocumentoLink(pb, mediazioneId, tipoAdesione, row.mediazionePayload.link_adesione, "Adesione chiamato (import)");
      await upsertDocumentoLink(pb, mediazioneId, tipoChiusura, row.mediazionePayload.link_documento_chiusura, "Documento chiusura (import)");

      // Incontro: se esiste già un incontro nello stesso giorno → nulla (non azzerare l'ora).
      // Un solo incontro in altro giorno → sposta la data (mantiene l'ora se Excel non la ha).
      // Più incontri e nessuno nel giorno Excel → non tocca nulla (non si sa quale sia).
      const dataIncontroRaw = (row.mediazionePayload.data_incontro ?? "").toString().trim();
      const oraIncontroRaw = (row.mediazionePayload.ora_incontro ?? "").toString().trim();
      const dataProg = buildDataProgrammazioneUTC(dataIncontroRaw, oraIncontroRaw);
      if (dataProg) {
        const existingIncontri = (await pb
          .collection("incontri")
          .getFullList({
            filter: pb.filter("mediazione = {:m}", { m: mediazioneId }),
            sort: "data_programmazione",
            fields: "id,data_programmazione",
          })
          .catch(() => [])) as { id: string; data_programmazione?: string }[];
        const excelDay = romeParts(dataProg)?.date;
        const sameDay = existingIncontri.find(
          (inc) => inc.data_programmazione && romeParts(inc.data_programmazione)?.date === excelDay
        );
        if (sameDay) {
          if (oraIncontroRaw && sameDay.data_programmazione !== dataProg) {
            await pb.collection("incontri").update(sameDay.id, { data_programmazione: dataProg });
          }
        } else if (existingIncontri.length === 1) {
          const inc = existingIncontri[0];
          const keepTime = !oraIncontroRaw && inc.data_programmazione
            ? romeParts(inc.data_programmazione)?.time
            : undefined;
          const next = keepTime ? buildDataProgrammazioneUTC(dataIncontroRaw, keepTime) ?? dataProg : dataProg;
          await pb.collection("incontri").update(inc.id, { data_programmazione: next });
        } else if (existingIncontri.length === 0) {
          await pb.collection("incontri").create({
            mediazione: mediazioneId,
            data_programmazione: dataProg,
            report: "",
          });
        }
      }

      await advanceStatoFromIncontri(pb, mediazioneId);

      success++;
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "Errore sconosciuto";
      errors.push({ index: row.index, error: msg });
    }
  }

  return { success, errors };
}
