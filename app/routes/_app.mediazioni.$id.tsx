import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { useState, useEffect } from "react";
import { Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import { AddParteDialog } from "~/components/add-parte-dialog";
import { AddAvvocatoDialog } from "~/components/add-avvocato-dialog";

// Converts a "YYYY-MM-DDTHH:MM" string (interpreted as Europe/Rome local time) to a
// PocketBase-compatible UTC string "YYYY-MM-DD HH:MM:SS.000Z".
function italianLocalToUTC(localStr: string): string | undefined {
  if (!localStr) return undefined;
  const [datePart, timePart] = localStr.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const approxEpoch = Date.UTC(y, mo - 1, d, h, mi, 0);

  // Get how many ms Rome is ahead of UTC at this approximate epoch
  const epochFromParts = (epoch: number, tz: string): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      hour12: false,
    }).formatToParts(new Date(epoch));
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");
    const fh = get("hour");
    return Date.UTC(get("year"), get("month") - 1, get("day"), fh >= 24 ? 0 : fh, get("minute"), get("second"));
  };

  const offsetMs = epochFromParts(approxEpoch, "Europe/Rome") - epochFromParts(approxEpoch, "UTC");
  return new Date(approxEpoch - offsetMs).toISOString().replace("T", " ").slice(0, 19) + ".000Z";
}

function canAccessMediazione(
  role: string | undefined,
  userId: string,
  mediatoreId: string | null
): boolean {
  if (role === "admin" || role === "manager") return true;
  if (role === "mediatore" && mediatoreId === userId) return true;
  return false;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const id = params.id;
  if (!id || request.method !== "POST") throw new Response("Bad Request", { status: 400 });

  const mediazione = await pb.collection("mediazioni").getOne(id);
  const role = getCurrentRole(user);
  const mediatoreId =
    typeof mediazione.mediatore === "string" ? mediazione.mediatore : mediazione.mediatore ?? null;
  if (!canAccessMediazione(role, user.id, mediatoreId)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "update") {
    const rgm = String(formData.get("rgm") ?? "").trim() || undefined;
    const oggetto = String(formData.get("oggetto") ?? "").trim() || undefined;
    const valore = String(formData.get("valore") ?? "").trim() || undefined;
    const competenza = String(formData.get("competenza") ?? "").trim() || undefined;
    const data_protocollo = formData.get("data_protocollo")
      ? String(formData.get("data_protocollo"))
      : undefined;
    const data_chiusura = formData.get("data_chiusura")
      ? String(formData.get("data_chiusura"))
      : undefined;
    const data_avvio_entro = formData.get("data_avvio_entro")
      ? String(formData.get("data_avvio_entro"))
      : undefined;
    const modalita_mediazione = String(formData.get("modalita_mediazione") ?? "").trim() || undefined;
    const motivazione_deposito = String(formData.get("motivazione_deposito") ?? "").trim() || undefined;
    const modalita_convocazione = String(formData.get("modalita_convocazione") ?? "").trim() || undefined;
    const esito_finale = String(formData.get("esito_finale") ?? "").trim() || undefined;
    const nota = String(formData.get("nota") ?? "").trim() || undefined;

    await pb.collection("mediazioni").update(id, {
      rgm,
      oggetto,
      valore,
      competenza,
      data_protocollo: data_protocollo || null,
      data_chiusura: data_chiusura || null,
      data_avvio_entro: data_avvio_entro || null,
      modalita_mediazione,
      motivazione_deposito,
      modalita_convocazione,
      esito_finale,
      nota: nota || undefined,
    });
  } else if (intent === "add_partecipazione") {
    const soggetto_id = formData.get("soggetto_id");
    const istante_o_chiamato = String(formData.get("istante_o_chiamato") ?? "").trim();
    if (!soggetto_id || !istante_o_chiamato) return redirect(`/mediazioni/${id}?tab=parti`);
    const existing = await pb.collection("partecipazioni").getFullList({
      filter: `mediazione = "${id}" && soggetto = "${soggetto_id}" && istante_o_chiamato = "${istante_o_chiamato}"`,
      limit: 1,
    });
    if (existing.length > 0) {
      return redirect(`/mediazioni/${id}?tab=parti&parti_duplicate=1`);
    }
    const avvocatiRaw = formData.getAll("avvocati[]");
    const avvocati = Array.isArray(avvocatiRaw) ? avvocatiRaw.filter(Boolean) : [];
    await pb.collection("partecipazioni").create({
      mediazione: id,
      soggetto: soggetto_id,
      istante_o_chiamato,
      avvocati: avvocati.length ? avvocati : undefined,
    });
    return redirect(`/mediazioni/${id}?tab=parti`);
  } else if (intent === "update_partecipazione") {
    const partecipazione_id = formData.get("partecipazione_id");
    const soggetto_id = formData.get("soggetto_id");
    const istante_o_chiamato = String(formData.get("istante_o_chiamato") ?? "").trim();
    if (!partecipazione_id || !soggetto_id || !istante_o_chiamato) {
      return redirect(`/mediazioni/${id}?tab=parti`);
    }
    const existing = await pb.collection("partecipazioni").getFullList({
      filter: `mediazione = "${id}" && soggetto = "${soggetto_id}" && istante_o_chiamato = "${istante_o_chiamato}" && id != "${partecipazione_id}"`,
      limit: 1,
    });
    if (existing.length > 0) {
      return redirect(`/mediazioni/${id}?tab=parti&parti_duplicate=1`);
    }
    const avvocatiRaw = formData.getAll("avvocati[]");
    const avvocati = Array.isArray(avvocatiRaw) ? avvocatiRaw.filter(Boolean) : [];
    await pb.collection("partecipazioni").update(String(partecipazione_id), {
      soggetto: soggetto_id,
      istante_o_chiamato,
      avvocati: avvocati.length ? avvocati : [],
    });
    return redirect(`/mediazioni/${id}?tab=parti`);
  } else if (intent === "delete_partecipazione") {
    const partecipazione_id = formData.get("partecipazione_id");
    if (!partecipazione_id) return redirect(`/mediazioni/${id}?tab=parti`);
    await pb.collection("partecipazioni").delete(String(partecipazione_id));
    return redirect(`/mediazioni/${id}?tab=parti`);
  } else if (intent === "create_soggetto_and_partecipazione") {
    const tipo = String(formData.get("tipo") ?? "").trim();
    const istante_o_chiamato = String(formData.get("istante_o_chiamato") ?? "").trim();
    if (!tipo || !istante_o_chiamato) return redirect(`/mediazioni/${id}?tab=parti`);

    const str = (key: string) => String(formData.get(key) ?? "").trim() || undefined;

    const soggettoData: Record<string, unknown> = { tipo };
    if (tipo === "Fisica") {
      soggettoData.nome = str("nome");
      soggettoData.cognome = str("cognome");
      soggettoData.codice_fiscale = str("codice_fiscale");
      soggettoData.email = str("email");
      soggettoData.indirizzo_riga_1 = str("indirizzo_riga_1");
      soggettoData.indirizzo_riga_2 = str("indirizzo_riga_2");
      soggettoData.numero_civico = str("numero_civico");
      soggettoData.comune = str("comune");
      soggettoData.provincia = str("provincia");
      soggettoData.cap = str("cap");
      soggettoData.paese = str("paese");
    } else if (tipo === "Giuridica") {
      soggettoData.ragione_sociale = str("ragione_sociale");
      soggettoData.piva = str("piva");
      soggettoData.codice_fiscale = str("codice_fiscale");
      soggettoData.pec = str("pec");
      soggettoData.indirizzo_riga_1 = str("indirizzo_riga_1");
      soggettoData.indirizzo_riga_2 = str("indirizzo_riga_2");
      soggettoData.numero_civico = str("numero_civico");
      soggettoData.comune = str("comune");
      soggettoData.provincia = str("provincia");
      soggettoData.cap = str("cap");
      soggettoData.paese = str("paese");
    }

    const newSoggetto = await pb.collection("soggetti").create(soggettoData);
    await pb.collection("partecipazioni").create({
      mediazione: id,
      soggetto: newSoggetto.id,
      istante_o_chiamato,
    });
    return redirect(`/mediazioni/${id}?tab=parti`);
  } else if (intent === "create_avvocato_and_update_partecipazione") {
    const partecipazione_id = formData.get("partecipazione_id");
    const soggetto_id = formData.get("soggetto_id");
    const istante_o_chiamato = formData.get("istante_o_chiamato");
    if (!partecipazione_id || !soggetto_id || !istante_o_chiamato) {
      return redirect(`/mediazioni/${id}?tab=parti`);
    }
    const str = (key: string) => String(formData.get(key) ?? "").trim() || undefined;
    const newAvvocato = await pb.collection("avvocati").create({
      nome: str("avv_nome"),
      cognome: str("avv_cognome"),
      pec: str("avv_pec"),
      telefono: str("avv_telefono"),
      foro_di_appartenenza: str("avv_foro"),
      numero_tessera_foro: str("avv_tessera"),
    });
    const existingIds = formData.getAll("avvocati[]").filter(Boolean).map(String);
    await pb.collection("partecipazioni").update(String(partecipazione_id), {
      soggetto: soggetto_id,
      istante_o_chiamato: String(istante_o_chiamato),
      avvocati: [...existingIds, newAvvocato.id],
    });
    return redirect(`/mediazioni/${id}?tab=parti`);
  } else if (intent === "remove_avvocato_from_partecipazione") {
    const partecipazione_id = String(formData.get("partecipazione_id") ?? "");
    const avvocato_id = String(formData.get("avvocato_id") ?? "");
    if (!partecipazione_id || !avvocato_id) return redirect(`/mediazioni/${id}?tab=parti`);
    const current = await pb.collection("partecipazioni").getOne(partecipazione_id) as Record<string, unknown>;
    const currentIds = (Array.isArray(current.avvocati) ? current.avvocati : []) as string[];
    await pb.collection("partecipazioni").update(partecipazione_id, {
      avvocati: currentIds.filter((x: string) => x !== avvocato_id),
    });
    return redirect(`/mediazioni/${id}?tab=parti`);
  } else if (intent === "update_avvocato") {
    const avvocato_id = String(formData.get("avvocato_id") ?? "");
    if (!avvocato_id) return redirect(`/mediazioni/${id}?tab=parti`);
    const str = (key: string) => String(formData.get(key) ?? "").trim() || undefined;
    await pb.collection("avvocati").update(avvocato_id, {
      nome: str("avv_nome"),
      cognome: str("avv_cognome"),
      pec: str("avv_pec"),
      telefono: str("avv_telefono"),
      foro_di_appartenenza: str("avv_foro"),
      numero_tessera_foro: str("avv_tessera"),
    });
    return redirect(`/mediazioni/${id}?tab=parti`);
  } else if (intent === "update_soggetto") {
    const soggetto_id = String(formData.get("soggetto_id") ?? "");
    if (!soggetto_id) return redirect(`/mediazioni/${id}?tab=parti`);
    const str = (key: string) => String(formData.get(key) ?? "").trim() || undefined;
    const tipo = String(formData.get("tipo") ?? "");
    const data: Record<string, unknown> = {
      indirizzo_riga_1: str("indirizzo_riga_1"),
      indirizzo_riga_2: str("indirizzo_riga_2"),
      numero_civico: str("numero_civico"),
      comune: str("comune"),
      provincia: str("provincia"),
      cap: str("cap"),
      paese: str("paese"),
    };
    if (tipo === "Fisica") {
      data.nome = str("nome");
      data.cognome = str("cognome");
      data.codice_fiscale = str("codice_fiscale");
      data.email = str("email");
    } else if (tipo === "Giuridica") {
      data.ragione_sociale = str("ragione_sociale");
      data.piva = str("piva");
      data.codice_fiscale = str("codice_fiscale");
      data.pec = str("pec");
    }
    await pb.collection("soggetti").update(soggetto_id, data);
    return redirect(`/mediazioni/${id}?tab=parti`);
  } else if (intent === "add_convocazione") {
    const partecipazione_id = formData.get("partecipazione_id");
    if (!partecipazione_id) return redirect(`/mediazioni/${id}?tab=convocazioni`);
    await pb.collection("convocazioni").create({
      partecipazione: partecipazione_id,
      data_invio: formData.get("data_invio") ? String(formData.get("data_invio")) : undefined,
      tipologia: String(formData.get("tipologia") ?? "PEC"),
      nota: String(formData.get("nota") ?? "").trim() || undefined,
    });
    return redirect(`/mediazioni/${id}?tab=convocazioni`);
  } else if (intent === "add_incontro") {
    await pb.collection("incontri").create({
      mediazione: id,
      data_programmazione: italianLocalToUTC(String(formData.get("data_programmazione") ?? "")),
      report: String(formData.get("report") ?? "").trim() || undefined,
      link_incontro: String(formData.get("link_incontro") ?? "").trim() || undefined,
    });
    return redirect(`/mediazioni/${id}?tab=incontri`);
  } else if (intent === "update_incontro") {
    const incontro_id = String(formData.get("incontro_id") ?? "");
    if (!incontro_id) return redirect(`/mediazioni/${id}?tab=incontri`);
    await pb.collection("incontri").update(incontro_id, {
      data_programmazione: italianLocalToUTC(String(formData.get("data_programmazione") ?? "")),
      report: String(formData.get("report") ?? "").trim() || undefined,
      link_incontro: String(formData.get("link_incontro") ?? "").trim() || undefined,
    });
    return redirect(`/mediazioni/${id}?tab=incontri`);
  } else if (intent === "delete_incontro") {
    const incontro_id = String(formData.get("incontro_id") ?? "");
    if (!incontro_id) return redirect(`/mediazioni/${id}?tab=incontri`);
    await pb.collection("incontri").delete(incontro_id);
    return redirect(`/mediazioni/${id}?tab=incontri`);
  } else if (intent === "add_documento") {
    const tipo = String(formData.get("tipo") ?? "").trim();
    const descrizione = String(formData.get("descrizione") ?? "").trim();
    const file = formData.get("file");

    if (!file) {
      return redirect(`/mediazioni/${id}?tab=documenti`);
    }

    const docForm = new FormData();
    docForm.append("mediazione", id);
    if (tipo) docForm.append("tipo", tipo);
    if (descrizione) docForm.append("descrizione", descrizione);
    docForm.append("file", file);

    await pb.collection("documenti").create(docForm);
    return redirect(`/mediazioni/${id}?tab=documenti`);
  } else if (intent === "delete_documento") {
    const documento_id = String(formData.get("documento_id") ?? "");
    if (!documento_id) return redirect(`/mediazioni/${id}?tab=documenti`);
    await pb.collection("documenti").delete(documento_id);
    return redirect(`/mediazioni/${id}?tab=documenti`);
  } else if (intent === "update_documento") {
    const documento_id = String(formData.get("documento_id") ?? "");
    if (!documento_id) return redirect(`/mediazioni/${id}?tab=documenti`);
    const tipo = String(formData.get("tipo") ?? "").trim();
    const descrizione = String(formData.get("descrizione") ?? "").trim();
    const file = formData.get("file");
    if (file && file instanceof File && file.size > 0) {
      const docForm = new FormData();
      docForm.append("tipo", tipo || "");
      docForm.append("descrizione", descrizione);
      docForm.append("file", file);
      await pb.collection("documenti").update(documento_id, docForm);
    } else {
      await pb.collection("documenti").update(documento_id, {
        tipo: tipo || "",
        descrizione: descrizione || undefined,
      });
    }
    return redirect(`/mediazioni/${id}?tab=documenti`);
  } else if (intent === "add_fattura") {
    const numero_fattura = String(formData.get("numero_fattura") ?? "").trim() || undefined;
    const data_emissione_fattura = formData.get("data_emissione_fattura")
      ? String(formData.get("data_emissione_fattura"))
      : undefined;
    const data_incasso = formData.get("data_incasso")
      ? String(formData.get("data_incasso"))
      : undefined;
    const imponibileRaw = formData.get("imponibile");
    const imponibile =
      imponibileRaw !== null && imponibileRaw !== ""
        ? Number(imponibileRaw)
        : undefined;
    const nota = String(formData.get("nota") ?? "").trim() || undefined;
    await pb.collection("fatture").create({
      mediazione: id,
      numero_fattura,
      data_emissione_fattura: data_emissione_fattura || null,
      data_incasso: data_incasso || null,
      imponibile,
      nota,
    });
    return redirect(`/mediazioni/${id}?tab=fatture`);
  } else if (intent === "delete_mediazione") {
    if (role !== "admin" && role !== "manager") {
      throw new Response("Forbidden", { status: 403 });
    }
    await pb.collection("mediazioni").delete(id);
    return redirect("/mediazioni");
  }
  return redirect(`/mediazioni/${id}`);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const id = params.id;
  if (!id) throw new Response("Not Found", { status: 404 });

  let mediazione: Record<string, unknown>;
  try {
    mediazione = await pb.collection("mediazioni").getOne(id, { expand: "mediatore" }) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof Response) throw e;
    throw new Response("Not Found", { status: 404 });
  }

  const role = getCurrentRole(user);
  const mediatoreId =
    typeof mediazione.mediatore === "string"
      ? mediazione.mediatore
      : (mediazione.mediatore as Record<string, string> | null) ?? null;
  if (!canAccessMediazione(role, user.id, mediatoreId)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const canDelete = role === "admin" || role === "manager";
  const showFatture = canDelete;

  async function safeGetFullList<T>(fn: () => Promise<T[]>): Promise<T[]> {
    try {
      const list = await fn();
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  const [
    partecipazioniResp,
    incontriResp,
    fattureResp,
    soggettiList,
    avvocatiList,
    documentiResp,
    documentiTipiResp,
    scaglioniResp,
    modalitaResp,
    competenzaResp,
    motivazioneDepositoResp,
    modalitaConvocazioneResp,
    materiaResp,
  ] = await Promise.all([
    safeGetFullList(() =>
      pb.collection("partecipazioni").getFullList({ filter: `mediazione = "${id}"` })
    ),
    safeGetFullList(() =>
      pb.collection("incontri").getFullList({ filter: `mediazione = "${id}"`, sort: "-data_programmazione" })
    ),
    showFatture
      ? safeGetFullList(() =>
          pb.collection("fatture").getFullList({ filter: `mediazione = "${id}"` })
        )
      : Promise.resolve([]),
    safeGetFullList(() =>
      pb.collection("soggetti").getFullList({ sort: "nome,cognome,ragione_sociale" })
    ),
    safeGetFullList(() =>
      pb.collection("avvocati").getFullList({ sort: "cognome,nome" })
    ),
    safeGetFullList(() =>
      pb.collection("documenti").getFullList({ filter: `mediazione = "${id}"`, expand: "tipo" })
    ),
    safeGetFullList(() =>
      pb.collection("documenti_tipi").getFullList({ filter: "attivo = true", sort: "nome" })
    ),
    safeGetFullList(() =>
      pb.collection("scaglioni_mediazione").getFullList({ filter: "attivo = true", sort: "nome" })
    ),
    safeGetFullList(() =>
      pb.collection("modalita_opzioni").getFullList({ filter: "attivo = true", sort: "nome" })
    ),
    safeGetFullList(() =>
      pb.collection("competenza_opzioni").getFullList({ filter: "attivo = true", sort: "nome" })
    ),
    safeGetFullList(() =>
      pb.collection("motivazione_deposito_opzioni").getFullList({ filter: "attivo = true", sort: "nome" })
    ),
    safeGetFullList(() =>
      pb.collection("modalita_convocazione_opzioni").getFullList({ filter: "attivo = true", sort: "nome" })
    ),
    safeGetFullList(() =>
      pb.collection("materia_opzioni").getFullList({ filter: "attivo = true", sort: "nome" })
    ),
  ]);

  // Token for protected file URLs (required when documenti.file is protected)
  let fileToken: string | null = null;
  try {
    if (pb.authStore.token) fileToken = await pb.files.getToken();
  } catch {
    // ignore
  }

  let convocazioniList: Array<{ id: string; partecipazione: string }> = [];
  const partecIds = partecipazioniResp.map((p: { id: string }) => p.id);
  if (partecIds.length > 0) {
    try {
      convocazioniList = await pb.collection("convocazioni").getFullList({
        filter: partecIds.map((pid: string) => `partecipazione = "${pid}"`).join(" || "),
      });
    } catch {
      convocazioniList = [];
    }
  }

  const convocazioniByPartec: Record<string, unknown[]> = {};
  partecIds.forEach((pid: string) => {
    convocazioniByPartec[pid] = convocazioniList.filter((c: { partecipazione: string }) => c.partecipazione === pid);
  });

  const soggettiById = Object.fromEntries((soggettiList as Record<string, unknown>[]).map((s) => [s.id, s]));
  const avvocatiById = Object.fromEntries((avvocatiList as Record<string, unknown>[]).map((a) => [a.id, a]));
  const partecipazioni = partecipazioniResp.map((p: Record<string, unknown>) => {
    const soggetto = soggettiById[p.soggetto as string] as Record<string, string> | undefined;
    const nomeSoggetto = soggetto
      ? (soggetto.tipo === "Giuridica" ? soggetto.ragione_sociale ?? "—" : [soggetto.nome, soggetto.cognome].filter(Boolean).join(" ") || "—")
      : "—";
    const avvocatiIds = (Array.isArray(p.avvocati) ? p.avvocati : [p.avvocati].filter(Boolean)) as string[];
    const avvocatiDetails = avvocatiIds
      .map((aid: string) => {
        const a = avvocatiById[aid] as Record<string, string> | undefined;
        if (!a) return null;
        return {
          id: aid,
          nome: a.nome || undefined,
          cognome: a.cognome || undefined,
          display: `${a.nome ?? ""} ${a.cognome ?? ""}`.trim() || a.pec || "—",
          pec: a.pec || undefined,
          telefono: a.telefono || undefined,
          foro: a.foro_di_appartenenza || undefined,
          tessera: a.numero_tessera_foro || undefined,
        };
      })
      .filter(Boolean) as Array<{ id: string; nome?: string; cognome?: string; display: string; pec?: string; telefono?: string; foro?: string; tessera?: string }>;
    return {
      id: p.id as string,
      istante_o_chiamato: p.istante_o_chiamato as string,
      soggetto_name: nomeSoggetto,
      soggetto_id: p.soggetto as string,
      soggetto_tipo: soggetto?.tipo || "",
      soggetto_nome: soggetto?.nome || undefined,
      soggetto_cognome: soggetto?.cognome || undefined,
      soggetto_ragione_sociale: soggetto?.ragione_sociale || undefined,
      soggetto_cf: soggetto?.codice_fiscale || undefined,
      soggetto_email: soggetto?.email || undefined,
      soggetto_pec: soggetto?.pec || undefined,
      soggetto_piva: soggetto?.piva || undefined,
      soggetto_comune: soggetto?.comune || undefined,
      soggetto_provincia: soggetto?.provincia || undefined,
      soggetto_cap: soggetto?.cap || undefined,
      soggetto_paese: soggetto?.paese || undefined,
      soggetto_indirizzo: soggetto?.indirizzo_riga_1 || undefined,
      soggetto_indirizzo_riga_2: soggetto?.indirizzo_riga_2 || undefined,
      soggetto_numero_civico: soggetto?.numero_civico || undefined,
      avvocati_details: avvocatiDetails,
      avvocati_ids: avvocatiIds,
      convocazioni: (convocazioniByPartec[p.id as string] ?? []) as Array<{
        id: string;
        data_invio?: string;
        tipologia?: string;
        nota?: string;
      }>,
    };
  });

  const incontri = (incontriResp as Record<string, unknown>[]).map((m) => ({
    id: m.id,
    data_programmazione: m.data_programmazione,
    data_inizio_effettiva: m.data_inizio_effettiva,
    data_fine_effettiva: m.data_fine_effettiva,
    report: m.report ?? "",
    link_incontro: m.link_incontro ?? "",
  }));

  const fatture = (fattureResp as Record<string, unknown>[]).map((f) => ({
    id: f.id,
    numero_fattura: f.numero_fattura ?? "",
    data_emissione_fattura: f.data_emissione_fattura,
    data_incasso: f.data_incasso,
    imponibile: f.imponibile ?? "",
    nota: f.nota ?? "",
  }));

  const soggetti = (soggettiList as Record<string, unknown>[]).map((s) => ({
    id: s.id as string,
    display:
      s.tipo === "Giuridica"
        ? (s.ragione_sociale as string || "—")
        : [s.nome, s.cognome].filter(Boolean).join(" ") || "—",
    secondary: s.tipo as string,
    codice_fiscale: (s.codice_fiscale as string) || undefined,
    email: (s.email as string) || undefined,
    pec: (s.pec as string) || undefined,
    piva: (s.piva as string) || undefined,
    comune: (s.comune as string) || undefined,
    provincia: (s.provincia as string) || undefined,
    indirizzo: (s.indirizzo_riga_1 as string) || undefined,
  }));
  const avvocati = (avvocatiList as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    display: [a.nome, a.cognome].filter(Boolean).join(" ") || (a.pec as string) || "—",
    secondary: (a.pec as string) || undefined,
    pec: (a.pec as string) || undefined,
    telefono: (a.telefono as string) || undefined,
    foro: (a.foro_di_appartenenza as string) || undefined,
    tessera: (a.numero_tessera_foro as string) || undefined,
  }));

  const documenti = (documentiResp as Record<string, unknown>[]).map((d) => {
    const expandTipo = d.expand?.tipo as { nome?: string } | undefined;
    const tipoNome = expandTipo?.nome ?? "";
    const tipoId = (d.tipo as string) ?? "";
    const fileUrl = d.file
      ? pb.files.getUrl(d as never, d.file as string, fileToken ? { token: fileToken } : undefined)
      : "";
    const linkLegacy = (d.link_legacy as string) ?? "";
    return {
      id: d.id as string,
      tipo: tipoNome,
      tipo_id: tipoId,
      descrizione: (d.descrizione as string) ?? "",
      file: (d.file as string) ?? "",
      file_url: fileUrl,
      link_legacy: linkLegacy,
    };
  });

  const documentiTipi = (documentiTipiResp as Record<string, unknown>[]).map((t) => ({
    id: t.id as string,
    nome: (t.nome as string) ?? "",
  }));

  const scaglioniOpzioni = (scaglioniResp as Record<string, unknown>[]).map((r) => (r.nome as string) ?? "");
  const modalitaOpzioni = (modalitaResp as Record<string, unknown>[]).map((r) => (r.nome as string) ?? "");
  const competenzaOpzioni = (competenzaResp as Record<string, unknown>[]).map((r) => (r.nome as string) ?? "");
  const motivazioneDepositoOpzioni = (motivazioneDepositoResp as Record<string, unknown>[]).map((r) => (r.nome as string) ?? "");
  const modalitaConvocazioneOpzioni = (modalitaConvocazioneResp as Record<string, unknown>[]).map((r) => (r.nome as string) ?? "");
  const materiaOpzioni = (materiaResp as Record<string, unknown>[]).map((r) => (r.nome as string) ?? "");

  const mediatoreExpanded = mediazione.expand?.mediatore as Record<string, string> | undefined;
  return json({
    mediazione: {
      id: mediazione.id,
      rgm: mediazione.rgm ?? "",
      data_protocollo: mediazione.data_protocollo ?? null,
      oggetto: mediazione.oggetto ?? "",
      valore: mediazione.valore ?? "",
      competenza: mediazione.competenza ?? "",
      modalita_mediazione: mediazione.modalita_mediazione ?? "",
      motivazione_deposito: mediazione.motivazione_deposito ?? "",
      modalita_convocazione: mediazione.modalita_convocazione ?? "",
      esito_finale: mediazione.esito_finale ?? "",
      data_chiusura: mediazione.data_chiusura ?? null,
      data_avvio_entro: mediazione.data_avvio_entro ?? null,
      nota: mediazione.nota ?? "",
      mediatore_name: mediatoreExpanded?.name ?? "—",
    },
    partecipazioni,
    incontri,
    fatture,
    documenti,
    documentiTipi,
    scaglioniOpzioni,
    modalitaOpzioni,
    competenzaOpzioni,
    motivazioneDepositoOpzioni,
    modalitaConvocazioneOpzioni,
    materiaOpzioni,
    showFatture,
    soggetti,
    avvocati,
    canDelete,
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Mediazione" }];
  const rgm = data.mediazione.rgm || "—";
  const istanti = data.partecipazioni
    .filter((p: { istante_o_chiamato: string }) => p.istante_o_chiamato === "Istante")
    .map((p: { soggetto_name: string }) => p.soggetto_name)
    .join(" & ");
  const chiamati = data.partecipazioni
    .filter((p: { istante_o_chiamato: string }) => p.istante_o_chiamato === "Chiamato")
    .map((p: { soggetto_name: string }) => p.soggetto_name)
    .join(" & ");
  const parti = [istanti || "—", chiamati || "—"].join(" / ");
  return [{ title: `${rgm} - ${parti}` }];
};

const ESITO_OPTIONS = [
  "",
  "Accordo",
  "Mancato accordo",
  "Improcedibile",
  "Chiusa d'ufficio",
  "Nessuna risposta",
];

const TABS = [
  { id: "parti", label: "Parti" },
  { id: "incontri", label: "Incontri" },
  { id: "convocazioni", label: "Convocazioni" },
  { id: "documenti", label: "Documenti" },
  { id: "fatture", label: "Fatture" },
] as const;

// ─── Parte Card ───────────────────────────────────────────────────────────────

type AvvocatoDetail = {
  id: string;
  nome?: string;
  cognome?: string;
  display: string;
  pec?: string;
  telefono?: string;
  foro?: string;
  tessera?: string;
};

type Parte = {
  id: string;
  istante_o_chiamato: string;
  soggetto_name: string;
  soggetto_id: string;
  soggetto_tipo: string;
  soggetto_nome?: string;
  soggetto_cognome?: string;
  soggetto_ragione_sociale?: string;
  soggetto_cf?: string;
  soggetto_email?: string;
  soggetto_pec?: string;
  soggetto_piva?: string;
  soggetto_comune?: string;
  soggetto_provincia?: string;
  soggetto_cap?: string;
  soggetto_paese?: string;
  soggetto_indirizzo?: string;
  soggetto_indirizzo_riga_2?: string;
  soggetto_numero_civico?: string;
  avvocati_details: AvvocatoDetail[];
  avvocati_ids: string[];
  convocazioni: Array<{
    id: string;
    data_invio?: string;
    tipologia?: string;
    nota?: string;
  }>;
};

function SoggettoDetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <span className="flex items-baseline gap-1 text-xs text-slate-600">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

// ─── Edit Avvocato Dialog ─────────────────────────────────────────────────────

const EDIT_INPUT =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#3aaeba] focus:border-[#3aaeba]";
const EDIT_LABEL = "block text-xs font-medium text-slate-600 mb-1";

function EditAvvocatoDialog({
  avvocato,
  onClose,
}: {
  avvocato: AvvocatoDetail | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!avvocato) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [avvocato, onClose]);

  if (!avvocato) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-800">Modifica avvocato</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Warning */}
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <span className="text-amber-500 text-sm mt-0.5 shrink-0">⚠</span>
          <p className="text-xs text-amber-800 leading-relaxed">
            Le modifiche si applicheranno a <strong>tutte le mediazioni</strong> in cui questo avvocato è presente nel database.
          </p>
        </div>

        {/* Form */}
        <Form method="post" onSubmit={onClose} className="px-5 py-4 space-y-3">
          <input type="hidden" name="_action" value="update_avvocato" />
          <input type="hidden" name="avvocato_id" value={avvocato.id} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={EDIT_LABEL}>Nome <span className="text-red-500">*</span></label>
              <input name="avv_nome" required defaultValue={avvocato.nome ?? ""} className={EDIT_INPUT} />
            </div>
            <div>
              <label className={EDIT_LABEL}>Cognome <span className="text-red-500">*</span></label>
              <input name="avv_cognome" required defaultValue={avvocato.cognome ?? ""} className={EDIT_INPUT} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={EDIT_LABEL}>PEC</label>
              <input name="avv_pec" type="email" defaultValue={avvocato.pec ?? ""} className={EDIT_INPUT} />
            </div>
            <div>
              <label className={EDIT_LABEL}>Telefono</label>
              <input name="avv_telefono" type="tel" defaultValue={avvocato.telefono ?? ""} className={EDIT_INPUT} />
            </div>
          </div>

          <div>
            <label className={EDIT_LABEL}>Foro di appartenenza</label>
            <input name="avv_foro" defaultValue={avvocato.foro ?? ""} className={EDIT_INPUT} />
          </div>

          <div>
            <label className={EDIT_LABEL}>N. tessera foro</label>
            <input name="avv_tessera" defaultValue={avvocato.tessera ?? ""} className={EDIT_INPUT} />
          </div>

          <div className="pt-2 flex gap-2.5">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Annulla
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors">
              Salva modifiche
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

// ─── Edit Soggetto Dialog ─────────────────────────────────────────────────────

function EditSoggettoDialog({
  parte,
  onClose,
}: {
  parte: Parte | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!parte) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [parte, onClose]);

  if (!parte) return null;
  const isGiuridica = parte.soggetto_tipo === "Giuridica";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Modifica soggetto</h2>
            <p className="text-xs text-slate-500 mt-0.5">{parte.soggetto_name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Warning */}
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 shrink-0">
          <span className="text-amber-500 text-sm mt-0.5 shrink-0">⚠</span>
          <p className="text-xs text-amber-800 leading-relaxed">
            Le modifiche si applicheranno a <strong>tutte le mediazioni</strong> in cui questo soggetto è presente nel database.
          </p>
        </div>

        {/* Form */}
        <Form method="post" onSubmit={onClose} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <input type="hidden" name="_action" value="update_soggetto" />
          <input type="hidden" name="soggetto_id" value={parte.soggetto_id} />
          <input type="hidden" name="tipo" value={parte.soggetto_tipo} />

          {isGiuridica ? (
            <>
              <div>
                <label className={EDIT_LABEL}>Ragione sociale <span className="text-red-500">*</span></label>
                <input name="ragione_sociale" required defaultValue={parte.soggetto_ragione_sociale ?? ""} className={EDIT_INPUT} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={EDIT_LABEL}>P.IVA</label>
                  <input name="piva" defaultValue={parte.soggetto_piva ?? ""} className={EDIT_INPUT} />
                </div>
                <div>
                  <label className={EDIT_LABEL}>Codice fiscale</label>
                  <input name="codice_fiscale" defaultValue={parte.soggetto_cf ?? ""} className={EDIT_INPUT} />
                </div>
              </div>
              <div>
                <label className={EDIT_LABEL}>PEC</label>
                <input name="pec" type="email" defaultValue={parte.soggetto_pec ?? ""} className={EDIT_INPUT} />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={EDIT_LABEL}>Nome <span className="text-red-500">*</span></label>
                  <input name="nome" required defaultValue={parte.soggetto_nome ?? ""} className={EDIT_INPUT} />
                </div>
                <div>
                  <label className={EDIT_LABEL}>Cognome <span className="text-red-500">*</span></label>
                  <input name="cognome" required defaultValue={parte.soggetto_cognome ?? ""} className={EDIT_INPUT} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={EDIT_LABEL}>Codice fiscale</label>
                  <input name="codice_fiscale" defaultValue={parte.soggetto_cf ?? ""} className={EDIT_INPUT} />
                </div>
                <div>
                  <label className={EDIT_LABEL}>Email</label>
                  <input name="email" type="email" defaultValue={parte.soggetto_email ?? ""} className={EDIT_INPUT} />
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div>
              <label className={EDIT_LABEL}>{isGiuridica ? "Sede legale" : "Indirizzo"}</label>
              <input name="indirizzo_riga_1" defaultValue={parte.soggetto_indirizzo ?? ""} className={EDIT_INPUT} />
            </div>
            <div>
              <label className={EDIT_LABEL}>N. civico</label>
              <input name="numero_civico" defaultValue={parte.soggetto_numero_civico ?? ""} className={EDIT_INPUT} />
            </div>
          </div>

          <div>
            <label className={EDIT_LABEL}>Indirizzo riga 2</label>
            <input name="indirizzo_riga_2" defaultValue={parte.soggetto_indirizzo_riga_2 ?? ""} className={EDIT_INPUT} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={EDIT_LABEL}>Comune</label>
              <input name="comune" defaultValue={parte.soggetto_comune ?? ""} className={EDIT_INPUT} />
            </div>
            <div>
              <label className={EDIT_LABEL}>Provincia</label>
              <input name="provincia" maxLength={2} placeholder="RM" defaultValue={parte.soggetto_provincia ?? ""} className={EDIT_INPUT} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={EDIT_LABEL}>CAP</label>
              <input name="cap" defaultValue={parte.soggetto_cap ?? ""} className={EDIT_INPUT} />
            </div>
            <div>
              <label className={EDIT_LABEL}>Paese</label>
              <input name="paese" defaultValue={parte.soggetto_paese ?? "Italia"} className={EDIT_INPUT} />
            </div>
          </div>

          <div className="pt-2 flex gap-2.5">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Annulla
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors">
              Salva modifiche
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

function ParteCard({
  parte,
  onManageAvvocati,
  onEditSoggetto,
  onEditAvvocato,
}: {
  parte: Parte;
  onManageAvvocati: (parte: Parte) => void;
  onEditSoggetto: (parte: Parte) => void;
  onEditAvvocato: (avvocato: AvvocatoDetail) => void;
}) {
  const isGiuridica = parte.soggetto_tipo === "Giuridica";
  const luogo = [parte.soggetto_comune, parte.soggetto_provincia ? `(${parte.soggetto_provincia})` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex">

      {/* ── LEFT: soggetto info ── */}
      <div className="flex-1 min-w-0 flex flex-col p-4 gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Name + type badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-slate-900 text-base leading-snug">
                {parte.soggetto_name}
              </p>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${
                  isGiuridica ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"
                }`}
              >
                {isGiuridica ? "Giuridica" : "Fisica"}
              </span>
            </div>

            {/* Fiscal / contact details */}
            <div className="mt-2 space-y-1">
              {isGiuridica ? (
                <>
                  <SoggettoDetailRow label="P.IVA" value={parte.soggetto_piva} />
                  <SoggettoDetailRow label="CF" value={parte.soggetto_cf} />
                  <SoggettoDetailRow label="PEC" value={parte.soggetto_pec} />
                </>
              ) : (
                <>
                  <SoggettoDetailRow label="CF" value={parte.soggetto_cf} />
                  <SoggettoDetailRow label="Email" value={parte.soggetto_email} />
                </>
              )}
              {parte.soggetto_indirizzo && (
                <SoggettoDetailRow
                  label="Ind."
                  value={luogo ? `${parte.soggetto_indirizzo}, ${luogo}` : parte.soggetto_indirizzo}
                />
              )}
              {!parte.soggetto_indirizzo && luogo && (
                <SoggettoDetailRow label="Comune" value={luogo} />
              )}
            </div>
          </div>

          {/* Delete parte */}
          <Form method="post" className="shrink-0">
            <input type="hidden" name="_action" value="delete_partecipazione" />
            <input type="hidden" name="partecipazione_id" value={parte.id} />
            <button
              type="submit"
              onClick={(e) => {
                if (!confirm("Eliminare questa parte dalla mediazione?")) e.preventDefault();
              }}
              className="rounded-md p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Elimina parte"
            >
              <X className="h-4 w-4" />
            </button>
          </Form>
        </div>

        {/* Footer actions — pinned to bottom */}
        <div className="mt-auto pt-2 border-t border-slate-100 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onEditSoggetto(parte)}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
          >
            <Pencil className="h-3 w-3" />
            Modifica soggetto
          </button>
        </div>
      </div>

      {/* ── RIGHT: avvocati ── */}
      <div className="w-[45%] shrink-0 flex flex-col border-l border-slate-100 bg-slate-50/50">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-slate-100">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Avvocati
            {parte.avvocati_details.length > 0 && (
              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 normal-case tracking-normal">
                {parte.avvocati_details.length}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onManageAvvocati(parte)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3aaeba] hover:text-[#349aa5] transition-colors"
          >
            <UserPlus className="h-3 w-3" />
            Gestisci
          </button>
        </div>

        {/* Avvocati list */}
        <div className="flex-1 px-4 py-3">
          {parte.avvocati_details.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Nessun avvocato associato</p>
          ) : (
            <div className="space-y-2">
              {parte.avvocati_details.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  {/* Avvocato name + action buttons */}
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-sm font-semibold text-slate-800 leading-snug">{a.display}</p>
                    <div className="flex items-center gap-0.5 shrink-0 ml-1">
                      {/* Edit avvocato */}
                      <button
                        type="button"
                        onClick={() => onEditAvvocato(a)}
                        className="rounded p-0.5 text-slate-300 hover:text-[#3aaeba] hover:bg-[#3aaeba]/10 transition-colors"
                        title="Modifica avvocato"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      {/* Remove avvocato from this partecipazione */}
                      <Form method="post">
                        <input type="hidden" name="_action" value="remove_avvocato_from_partecipazione" />
                        <input type="hidden" name="partecipazione_id" value={parte.id} />
                        <input type="hidden" name="avvocato_id" value={a.id} />
                        <button
                          type="submit"
                          onClick={(e) => {
                            if (!confirm(`Rimuovere ${a.display} da questa parte?`)) e.preventDefault();
                          }}
                          className="rounded p-0.5 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Rimuovi avvocato"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Form>
                    </div>
                  </div>
                  {/* Details */}
                  <div className="mt-0.5 space-y-0.5">
                    {a.pec && <span className="block text-xs text-slate-500 truncate">{a.pec}</span>}
                    {a.foro && <span className="block text-xs text-slate-500">Foro: {a.foro}</span>}
                    {a.tessera && <span className="block text-xs text-slate-500">N° {a.tessera}</span>}
                    {a.telefono && <span className="block text-xs text-slate-500">{a.telefono}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Add Incontro Dialog ──────────────────────────────────────────────────────

function AddIncontroDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-800">Nuovo incontro</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Form method="post" onSubmit={onClose} className="px-5 py-4 space-y-4">
          <input type="hidden" name="_action" value="add_incontro" />
          <div>
            <label className={EDIT_LABEL}>Data e ora programmazione</label>
            <input type="datetime-local" name="data_programmazione" className={EDIT_INPUT} />
          </div>
          <div>
            <label className={EDIT_LABEL}>Link Google Meet</label>
            <input
              type="url"
              name="link_incontro"
              placeholder="https://meet.google.com/xxx-xxxx-xxx"
              className={EDIT_INPUT}
            />
          </div>
          <div>
            <label className={EDIT_LABEL}>Report</label>
            <textarea name="report" rows={3} className={EDIT_INPUT} placeholder="Testo o HTML" />
          </div>
          <div className="pt-1 flex gap-2.5">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Annulla
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors">
              Aggiungi incontro
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

// ─── Edit Incontro Dialog ──────────────────────────────────────────────────────

function EditIncontroDialog({ incontro, onClose }: { incontro: Incontro | null; onClose: () => void }) {
  useEffect(() => {
    if (!incontro) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [incontro, onClose]);

  if (!incontro) return null;

  // Convert UTC stored value → "YYYY-MM-DDTHH:MM" in Italian local time for datetime-local input
  const toInputDatetime = (d: string | null): string => {
    if (!d) return "";
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    }).format(new Date(d)).replace(" ", "T");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-800">Modifica incontro</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Form method="post" onSubmit={onClose} className="px-5 py-4 space-y-4">
          <input type="hidden" name="_action" value="update_incontro" />
          <input type="hidden" name="incontro_id" value={incontro.id} />
          <div>
            <label className={EDIT_LABEL}>Data e ora programmazione</label>
            <input type="datetime-local" name="data_programmazione" defaultValue={toInputDatetime(incontro.data_programmazione)} className={EDIT_INPUT} />
          </div>
          <div>
            <label className={EDIT_LABEL}>Link Google Meet</label>
            <input
              type="url"
              name="link_incontro"
              placeholder="https://meet.google.com/xxx-xxxx-xxx"
              defaultValue={incontro.link_incontro}
              className={EDIT_INPUT}
            />
          </div>
          <div>
            <label className={EDIT_LABEL}>Report</label>
            <textarea name="report" rows={3} defaultValue={incontro.report} className={EDIT_INPUT} placeholder="Testo o HTML" />
          </div>
          <div className="pt-1 flex gap-2.5">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Annulla
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors">
              Salva modifiche
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

// ─── Add Convocazione Dialog ───────────────────────────────────────────────────

function AddConvocazioneDialog({
  isOpen,
  onClose,
  partecipazioni,
}: {
  isOpen: boolean;
  onClose: () => void;
  partecipazioni: Parte[];
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-800">Nuova convocazione</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        {partecipazioni.length === 0 ? (
          <div className="px-5 py-4 text-slate-500 text-sm">
            Aggiungi prima almeno una parte (Istante o Chiamato) nella tab Parti.
          </div>
        ) : (
          <Form method="post" onSubmit={onClose} className="px-5 py-4 space-y-4">
            <input type="hidden" name="_action" value="add_convocazione" />
            <div>
              <label className={EDIT_LABEL}>Parte (soggetto) <span className="text-red-500">*</span></label>
              <select
                name="partecipazione_id"
                required
                className={EDIT_INPUT}
              >
                <option value="">— Seleziona parte —</option>
                {partecipazioni.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.soggetto_name} ({p.istante_o_chiamato})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={EDIT_LABEL}>Data invio</label>
                <input type="date" name="data_invio" className={EDIT_INPUT} />
              </div>
              <div>
                <label className={EDIT_LABEL}>Tipologia</label>
                <select name="tipologia" defaultValue="PEC" className={EDIT_INPUT}>
                  <option value="PEC">PEC</option>
                  <option value="Raccomandata">Raccomandata</option>
                </select>
              </div>
            </div>
            <div>
              <label className={EDIT_LABEL}>Nota</label>
              <textarea name="nota" rows={2} className={EDIT_INPUT} placeholder="Note sulla convocazione" />
            </div>
            <div className="pt-1 flex gap-2.5">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                Annulla
              </button>
              <button type="submit" className="flex-1 rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors">
                Aggiungi convocazione
              </button>
            </div>
          </Form>
        )}
      </div>
    </div>
  );
}

// ─── Add Documento Dialog ───────────────────────────────────────────────────────

function AddDocumentoDialog({
  isOpen,
  onClose,
  documentiTipi,
}: {
  isOpen: boolean;
  onClose: () => void;
  documentiTipi: Array<{ id: string; nome: string }>;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-800">Aggiungi documento</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Form method="post" encType="multipart/form-data" onSubmit={onClose} className="px-5 py-4 space-y-4">
          <input type="hidden" name="_action" value="add_documento" />
          <div>
            <label className={EDIT_LABEL}>Tipo</label>
            <select name="tipo" className={EDIT_INPUT} defaultValue="">
              <option value="">— Seleziona tipo —</option>
              {documentiTipi.map((t) => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={EDIT_LABEL}>File <span className="text-red-500">*</span></label>
            <input
              name="file"
              type="file"
              required
              className="block w-full text-sm text-slate-700 file:mr-2 file:rounded file:border-0 file:bg-slate-200 file:px-2 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-300"
            />
          </div>
          <div>
            <label className={EDIT_LABEL}>Descrizione</label>
            <textarea name="descrizione" rows={2} className={EDIT_INPUT} placeholder="Note o descrizione del documento" />
          </div>
          <div className="pt-1 flex gap-2.5">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Annulla
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors">
              Salva documento
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

// ─── Edit Documento Dialog ─────────────────────────────────────────────────────

function EditDocumentoDialog({
  isOpen,
  onClose,
  documento,
  documentiTipi,
}: {
  isOpen: boolean;
  onClose: () => void;
  documento: { id: string; tipo: string; tipo_id: string; descrizione: string; file_url: string; link_legacy: string };
  documentiTipi: Array<{ id: string; nome: string }>;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-800">Modifica documento</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Form method="post" encType="multipart/form-data" onSubmit={onClose} className="px-5 py-4 space-y-4">
          <input type="hidden" name="_action" value="update_documento" />
          <input type="hidden" name="documento_id" value={documento.id} />
          <div>
            <label className={EDIT_LABEL}>Tipo</label>
            <select name="tipo" className={EDIT_INPUT} defaultValue={documento.tipo_id}>
              <option value="">— Seleziona tipo —</option>
              {documentiTipi.map((t) => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={EDIT_LABEL}>File (lascia vuoto per non cambiare)</label>
            <input
              name="file"
              type="file"
              className="block w-full text-sm text-slate-700 file:mr-2 file:rounded file:border-0 file:bg-slate-200 file:px-2 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-300"
            />
            {documento.file_url ? (
              <a href={documento.file_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[#3aaeba] hover:underline">
                Scarica file attuale
              </a>
            ) : documento.link_legacy ? (
              <a href={documento.link_legacy} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[#3aaeba] hover:underline">
                Apri link attuale
              </a>
            ) : null}
          </div>
          <div>
            <label className={EDIT_LABEL}>Descrizione</label>
            <textarea name="descrizione" rows={2} className={EDIT_INPUT} placeholder="Note o descrizione del documento" defaultValue={documento.descrizione} />
          </div>
          <div className="pt-1 flex gap-2.5">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Annulla
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors">
              Salva modifiche
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

// ─── Add Fattura Dialog ────────────────────────────────────────────────────────

function AddFatturaDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-800">Nuova fattura</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Form method="post" onSubmit={onClose} className="px-5 py-4 space-y-4">
          <input type="hidden" name="_action" value="add_fattura" />
          <div>
            <label className={EDIT_LABEL}>N. Fattura</label>
            <input name="numero_fattura" className={EDIT_INPUT} placeholder="es. 2024-001" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={EDIT_LABEL}>Data emissione</label>
              <input type="date" name="data_emissione_fattura" className={EDIT_INPUT} />
            </div>
            <div>
              <label className={EDIT_LABEL}>Data incasso</label>
              <input type="date" name="data_incasso" className={EDIT_INPUT} />
            </div>
          </div>
          <div>
            <label className={EDIT_LABEL}>Imponibile (€)</label>
            <input name="imponibile" type="number" step="0.01" min="0" className={EDIT_INPUT} placeholder="0.00" />
          </div>
          <div>
            <label className={EDIT_LABEL}>Nota</label>
            <textarea name="nota" rows={2} className={EDIT_INPUT} />
          </div>
          <div className="pt-1 flex gap-2.5">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Annulla
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors">
              Aggiungi fattura
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type Incontro = {
  id: string;
  data_programmazione: string | null;
  data_inizio_effettiva: string | null;
  data_fine_effettiva: string | null;
  report: string;
  link_incontro: string;
};

type DialogMode =
  | { type: "addParte" }
  | { type: "manageAvvocati"; parte: Parte }
  | { type: "editAvvocato"; avvocato: AvvocatoDetail }
  | { type: "editSoggetto"; parte: Parte }
  | { type: "addIncontro" }
  | { type: "editIncontro"; incontro: Incontro }
  | { type: "addConvocazione" }
  | { type: "addDocumento" }
  | { type: "editDocumento"; documento: { id: string; tipo: string; tipo_id: string; descrizione: string; file_url: string; link_legacy: string } }
  | { type: "addFattura" }
  | null;

export default function MediazioneDetail() {
  const {
    mediazione,
    partecipazioni,
    incontri,
    fatture,
    documenti,
    documentiTipi,
    scaglioniOpzioni,
    modalitaOpzioni,
    competenzaOpzioni,
    motivazioneDepositoOpzioni,
    modalitaConvocazioneOpzioni,
    materiaOpzioni,
    showFatture,
    soggetti,
    avvocati,
    canDelete,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as (typeof TABS)[number]["id"]) || "parti";
  const [editMode, setEditMode] = useState(false);
  const [editingPartecipazioneId, setEditingPartecipazioneId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);

  const editingPartecipazione =
    partecipazioni.find((p) => p.id === editingPartecipazioneId) ?? null;

  const istanti = partecipazioni.filter((p) => p.istante_o_chiamato === "Istante");
  const chiamati = partecipazioni.filter((p) => p.istante_o_chiamato === "Chiamato");

  function openAddParteDialog() {
    setDialogMode({ type: "addParte" });
  }

  function openManageAvvocatiDialog(parte: Parte) {
    setDialogMode({ type: "manageAvvocati", parte });
  }

  function openEditAvvocatoDialog(avvocato: AvvocatoDetail) {
    setDialogMode({ type: "editAvvocato", avvocato });
  }

  function openEditSoggettoDialog(parte: Parte) {
    setDialogMode({ type: "editSoggetto", parte });
  }

  function closeDialog() {
    setDialogMode(null);
  }

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("it-IT") : "—";
  const toInputDate = (d: string | null) =>
    d ? new Date(d).toISOString().slice(0, 10) : "";

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/mediazioni"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Elenco mediazioni
        </Link>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="hidden sm:inline">
            ID: {mediazione.id}
          </span>
          {canDelete && (
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm("Sei sicuro di voler eliminare questa mediazione?")) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="_action" value="delete_mediazione" />
              <button
                type="submit"
                className="btn btn-ghost btn-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                title="Elimina mediazione"
                aria-label="Elimina mediazione"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </Form>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)] items-start">
        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="text-base sm:text-lg font-semibold text-slate-800">
              Mediazione {mediazione.rgm || mediazione.id}
            </h1>
            {!editMode && (
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="inline-flex items-center justify-center rounded-lg bg-[#3aaeba] p-1.5 text-white hover:bg-[#349aa5]"
                title="Modifica dati"
                aria-label="Modifica dati"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {!editMode ? (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">RGM</dt>
                <dd className="text-slate-900">{mediazione.rgm || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Data protocollo</dt>
                <dd className="text-slate-900">{formatDate(mediazione.data_protocollo)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Mediatore</dt>
                <dd className="text-slate-900">{mediazione.mediatore_name}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium text-slate-500 mb-0.5">Oggetto</dt>
                <dd className="text-slate-900 line-clamp-3">{mediazione.oggetto || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Valore</dt>
                <dd className="text-slate-900">{mediazione.valore || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Competenza</dt>
                <dd className="text-slate-900">{mediazione.competenza || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Modalità mediazione</dt>
                <dd className="text-slate-900">{mediazione.modalita_mediazione || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Motivazione deposito</dt>
                <dd className="text-slate-900">{mediazione.motivazione_deposito || "—"}</dd>
              </div>
              {(mediazione.motivazione_deposito === "Disposta dal giudice" || mediazione.data_avvio_entro) && (
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Data avvio entro</dt>
                  <dd className="text-slate-900">{formatDate(mediazione.data_avvio_entro)}</dd>
                </div>
              )}
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Modalità convocazione</dt>
                <dd className="text-slate-900">{mediazione.modalita_convocazione || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Esito</dt>
                <dd className="text-slate-900">{mediazione.esito_finale || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500 mb-0.5">Data chiusura</dt>
                <dd className="text-slate-900">{formatDate(mediazione.data_chiusura)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium text-slate-500 mb-0.5">Nota</dt>
                <dd className="text-slate-900 whitespace-pre-wrap max-h-40 overflow-auto text-xs sm:text-sm">
                  {mediazione.nota || "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <Form method="post" className="space-y-3">
              <input type="hidden" name="_action" value="update" />
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">RGM</dt>
                  <dd>
                    <input
                      name="rgm"
                      defaultValue={mediazione.rgm}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Data protocollo</dt>
                  <dd>
                    <input
                      name="data_protocollo"
                      type="date"
                      defaultValue={toInputDate(mediazione.data_protocollo)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Mediatore</dt>
                  <dd className="mt-0.5 text-slate-900 text-sm">{mediazione.mediatore_name}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Esito</dt>
                  <dd>
                    <select
                      name="esito_finale"
                      defaultValue={mediazione.esito_finale || ""}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 bg-white"
                    >
                      {ESITO_OPTIONS.map((o) => (
                        <option key={o || "empty"} value={o}>{o || "—"}</option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-500 mb-0.5">Oggetto / Materia</dt>
                  <dd>
                    <input
                      name="oggetto"
                      list="materia-list"
                      defaultValue={mediazione.oggetto}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                    <datalist id="materia-list">
                      {materiaOpzioni.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Valore</dt>
                  <dd>
                    <input
                      name="valore"
                      list="scaglioni-list"
                      defaultValue={mediazione.valore}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                    <datalist id="scaglioni-list">
                      {scaglioniOpzioni.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Competenza</dt>
                  <dd>
                    <input
                      name="competenza"
                      list="competenza-list"
                      defaultValue={mediazione.competenza}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                    <datalist id="competenza-list">
                      {competenzaOpzioni.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Modalità mediazione</dt>
                  <dd>
                    <input
                      name="modalita_mediazione"
                      list="modalita-list"
                      defaultValue={mediazione.modalita_mediazione}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                    <datalist id="modalita-list">
                      {modalitaOpzioni.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Motivazione deposito</dt>
                  <dd>
                    <input
                      name="motivazione_deposito"
                      list="motivazione-deposito-list"
                      defaultValue={mediazione.motivazione_deposito}
                      placeholder="es. Quale condizione di procedibilità"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                    <datalist id="motivazione-deposito-list">
                      {motivazioneDepositoOpzioni.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Data avvio entro</dt>
                  <dd>
                    <input
                      name="data_avvio_entro"
                      type="date"
                      defaultValue={toInputDate(mediazione.data_avvio_entro)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                      title="Obbligatorio se motivazione deposito è «Disposta dal giudice»"
                    />
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Modalità convocazione</dt>
                  <dd>
                    <input
                      name="modalita_convocazione"
                      list="modalita-convocazione-list"
                      defaultValue={mediazione.modalita_convocazione}
                      placeholder="es. Pec alla parte"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                    <datalist id="modalita-convocazione-list">
                      {modalitaConvocazioneOpzioni.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500 mb-0.5">Data chiusura</dt>
                  <dd>
                    <input
                      name="data_chiusura"
                      type="date"
                      defaultValue={toInputDate(mediazione.data_chiusura)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-500 mb-0.5">Nota</dt>
                  <dd>
                    <textarea
                      name="nota"
                      rows={3}
                      defaultValue={mediazione.nota}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </dd>
                </div>
              </dl>
              <div className="pt-1 flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-[#3aaeba] px-3 py-1.5 text-xs sm:text-sm font-medium text-white hover:bg-[#349aa5]"
                >
                  Salva modifiche
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Annulla
                </button>
              </div>
            </Form>
          )}

        </section>
        <button
          type="button"
          className="w-full rounded-lg bg-[#3aaeba] px-3 py-2 text-sm font-medium text-white hover:bg-[#349aa5]"
        >
          Genera verbale
        </button>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <nav className="flex flex-wrap gap-1 border-b border-slate-200 mb-4">
          {TABS.filter((t) => t.id !== "fatture" || showFatture).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSearchParams({ tab: t.id })}
              className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-t ${
                tab === t.id
                  ? "bg-white border border-slate-200 border-b-white -mb-px text-[#3aaeba]"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
          </nav>

          {/* ── PARTI TAB ── */}
          {tab === "parti" && (
            <div className="space-y-6">
              {searchParams.get("parti_duplicate") === "1" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                  <p className="text-sm">
                    Questo soggetto è già presente come Istante o Chiamato in questa mediazione. Non sono ammessi duplicati per ruolo.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.delete("parti_duplicate");
                      setSearchParams(next, { replace: true });
                    }}
                    className="shrink-0 rounded p-1 hover:bg-amber-100"
                    aria-label="Chiudi"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              {/* Istanti section */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-800">
                    Istanti
                    {istanti.length > 0 && (
                      <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-600">
                        {istanti.length}
                      </span>
                    )}
                  </h2>
                  <button
                    type="button"
                    onClick={() => openAddParteDialog()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#3aaeba] px-3 py-1.5 text-white hover:bg-[#349aa5] transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">Aggiungi parte</span>
                  </button>
                </div>
                {istanti.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
                    <p className="text-sm text-slate-400">Nessun istante</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {istanti.map((p) => (
                      <ParteCard
                        key={p.id}
                        parte={p}
                        onManageAvvocati={openManageAvvocatiDialog}
                        onEditSoggetto={openEditSoggettoDialog}
                        onEditAvvocato={openEditAvvocatoDialog}
                      />
                    ))}
                  </div>
                )}
              </section>

              <div className="border-t border-slate-100" />

              {/* Chiamati section */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-800">
                    Chiamati
                    {chiamati.length > 0 && (
                      <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-600">
                        {chiamati.length}
                      </span>
                    )}
                  </h2>
                </div>
                {chiamati.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
                    <p className="text-sm text-slate-400">Nessun chiamato</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chiamati.map((p) => (
                      <ParteCard
                        key={p.id}
                        parte={p}
                        onManageAvvocati={openManageAvvocatiDialog}
                        onEditSoggetto={openEditSoggettoDialog}
                        onEditAvvocato={openEditAvvocatoDialog}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

        {tab === "incontri" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-800">
                Incontri
                {incontri.length > 0 && (
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-600">
                    {incontri.length}
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => setDialogMode({ type: "addIncontro" })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#3aaeba] px-3 py-1.5 text-white hover:bg-[#349aa5] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-sm font-medium">Aggiungi incontro</span>
              </button>
            </div>
            {incontri.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
                <p className="text-sm text-slate-400">Nessun incontro</p>
              </div>
            ) : (
              incontri.map((inc) => (
                <div
                  key={inc.id}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-slate-900 text-sm">
                      {inc.data_programmazione
                        ? new Date(inc.data_programmazione as string).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setDialogMode({ type: "editIncontro", incontro: inc as Incontro })}
                        className="rounded p-1 text-slate-300 hover:text-[#3aaeba] hover:bg-[#3aaeba]/10 transition-colors"
                        title="Modifica incontro"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <Form method="post">
                        <input type="hidden" name="_action" value="delete_incontro" />
                        <input type="hidden" name="incontro_id" value={inc.id as string} />
                        <button
                          type="submit"
                          onClick={(e) => { if (!confirm("Eliminare questo incontro?")) e.preventDefault(); }}
                          className="rounded p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Elimina incontro"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </Form>
                    </div>
                  </div>
                  {inc.link_incontro && (
                    <a
                      href={inc.link_incontro}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-sm text-[#3aaeba] hover:underline"
                    >
                      Apri Google Meet
                    </a>
                  )}
                  {inc.report && (
                    <div
                      className="mt-1 text-slate-700 prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: inc.report }}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "convocazioni" && (
          <div className="space-y-3 text-xs sm:text-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-800">
                Convocazioni
                {(partecipazioni.reduce((n, p) => n + p.convocazioni.length, 0) > 0) && (
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-600">
                    {partecipazioni.reduce((n, p) => n + p.convocazioni.length, 0)}
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => setDialogMode({ type: "addConvocazione" })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#3aaeba] px-3 py-1.5 text-white hover:bg-[#349aa5] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-sm font-medium">Aggiungi convocazione</span>
              </button>
            </div>
            {partecipazioni.flatMap((p) =>
              p.convocazioni.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-slate-200 bg-white p-3 flex justify-between items-start"
                >
                  <div>
                    <span className="font-medium text-slate-800">{p.soggetto_name}</span>
                    <span className="text-slate-500 ml-2">({p.istante_o_chiamato})</span>
                    <p className="text-slate-600 mt-0.5">
                      {c.data_invio
                        ? new Date(c.data_invio).toLocaleDateString("it-IT")
                        : "—"}{" "}
                      · {c.tipologia ?? "—"}
                    </p>
                    {c.nota && <p className="text-slate-500">{c.nota}</p>}
                  </div>
                </div>
              ))
            )}
            {partecipazioni.every((p) => p.convocazioni.length === 0) && (
              <p className="text-slate-500">Nessuna convocazione.</p>
            )}
          </div>
        )}

        {tab === "documenti" && (
          <div className="space-y-3 text-xs sm:text-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-800">
                Documenti
                {documenti.length > 0 && (
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-600">
                    {documenti.length}
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => setDialogMode({ type: "addDocumento" })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#3aaeba] px-3 py-1.5 text-white hover:bg-[#349aa5] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-sm font-medium">Aggiungi documento</span>
              </button>
            </div>
            <p className="text-slate-600">
              Documenti caricati su PocketBase per questa mediazione.
            </p>
            {documenti.length === 0 ? (
              <p className="text-slate-500">Nessun documento caricato.</p>
            ) : (
              <ul className="space-y-2">
                {documenti.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-lg border border-slate-200 bg-white p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{d.tipo || "Documento"}</p>
                      {d.descrizione && (
                        <p className="text-slate-600 text-xs sm:text-sm line-clamp-2">{d.descrizione}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {d.file_url ? (
                        <a
                          href={d.file_url}
                          className="rounded border border-slate-300 px-2.5 py-1 text-[11px] sm:text-xs text-slate-700 hover:bg-slate-50"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Scarica
                        </a>
                      ) : d.link_legacy ? (
                        <a
                          href={d.link_legacy}
                          className="rounded border border-slate-300 px-2.5 py-1 text-[11px] sm:text-xs text-slate-700 hover:bg-slate-50"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Apri link
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setDialogMode({ type: "editDocumento", documento: d })}
                        className="rounded p-1 text-slate-300 hover:text-[#3aaeba] hover:bg-[#3aaeba]/10 transition-colors"
                        title="Modifica documento"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <Form method="post">
                        <input type="hidden" name="_action" value="delete_documento" />
                        <input type="hidden" name="documento_id" value={d.id} />
                        <button
                          type="submit"
                          onClick={(e) => { if (!confirm("Eliminare questo documento?")) e.preventDefault(); }}
                          className="rounded p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Elimina documento"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "fatture" && showFatture && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-800">
                Fatture
                {fatture.length > 0 && (
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-600">
                    {fatture.length}
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => setDialogMode({ type: "addFattura" })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#3aaeba] px-3 py-1.5 text-white hover:bg-[#349aa5] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-sm font-medium">Aggiungi fattura</span>
              </button>
            </div>
            {fatture.length === 0 ? (
              <p className="text-slate-500 text-xs sm:text-sm">Nessuna fattura.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-[11px] sm:text-xs font-medium text-slate-500">
                        N. Fattura
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] sm:text-xs font-medium text-slate-500">
                        Data emissione
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] sm:text-xs font-medium text-slate-500">
                        Imponibile
                      </th>
                      <th className="px-3 py-2 text-left text-[11px] sm:text-xs font-medium text-slate-500">
                        Nota
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {fatture.map((f) => (
                      <tr key={f.id}>
                        <td className="px-3 py-1.5 text-xs sm:text-sm text-slate-900">{f.numero_fattura}</td>
                        <td className="px-3 py-1.5 text-xs sm:text-sm text-slate-600">
                          {f.data_emissione_fattura
                            ? new Date(f.data_emissione_fattura).toLocaleDateString("it-IT")
                            : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-xs sm:text-sm text-slate-600">
                          {f.imponibile != null ? `€ ${Number(f.imponibile)}` : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] sm:text-xs text-slate-600">
                          {f.nota || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        </section>
      </div>

      {/* ── Edit partecipazione dialog (existing) ── */}
      {editingPartecipazione && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm sm:text-base font-semibold text-slate-800">
                Modifica parte
              </h2>
              <button
                type="button"
                onClick={() => setEditingPartecipazioneId(null)}
                className="rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <Form method="post" className="px-4 py-3 space-y-3 text-xs sm:text-sm"
              onSubmit={() => setEditingPartecipazioneId(null)}>
              <input type="hidden" name="_action" value="update_partecipazione" />
              <input type="hidden" name="partecipazione_id" value={editingPartecipazione.id} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Soggetto
                  </label>
                  <select
                    name="soggetto_id"
                    defaultValue={editingPartecipazione.soggetto_id}
                    required
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs sm:text-sm"
                  >
                    <option value="">— Seleziona —</option>
                    {soggetti.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.display}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Ruolo
                  </label>
                  <select
                    name="istante_o_chiamato"
                    defaultValue={editingPartecipazione.istante_o_chiamato}
                    required
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs sm:text-sm"
                  >
                    <option value="Istante">Istante</option>
                    <option value="Chiamato">Chiamato</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Avvocati
                </label>
                <select
                  name="avvocati[]"
                  multiple
                  defaultValue={editingPartecipazione.avvocati_ids}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs sm:text-sm h-24"
                >
                  {avvocati.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.display}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Tieni premuto Ctrl (o Cmd su Mac) per selezionare più avvocati.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingPartecipazioneId(null)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs sm:text-sm text-slate-700 hover:bg-slate-50"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="rounded bg-[#3aaeba] px-3 py-1.5 text-xs sm:text-sm font-medium text-white hover:bg-[#349aa5]"
                >
                  Salva
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}

      {/* ── Add Parte dialog ── */}
      <AddParteDialog
        isOpen={dialogMode?.type === "addParte"}
        onClose={closeDialog}
        soggetti={soggetti}
      />

      {/* ── Manage Avvocati dialog ── */}
      <AddAvvocatoDialog
        isOpen={dialogMode?.type === "manageAvvocati"}
        onClose={closeDialog}
        parte={dialogMode?.type === "manageAvvocati" ? dialogMode.parte : null}
        avvocati={avvocati}
      />

      {/* ── Edit Avvocato dialog ── */}
      <EditAvvocatoDialog
        avvocato={dialogMode?.type === "editAvvocato" ? dialogMode.avvocato : null}
        onClose={closeDialog}
      />

      {/* ── Edit Soggetto dialog ── */}
      <EditSoggettoDialog
        parte={dialogMode?.type === "editSoggetto" ? dialogMode.parte : null}
        onClose={closeDialog}
      />

      {/* ── Add Incontro dialog ── */}
      <AddIncontroDialog
        isOpen={dialogMode?.type === "addIncontro"}
        onClose={closeDialog}
      />

      {/* ── Edit Incontro dialog ── */}
      <EditIncontroDialog
        incontro={dialogMode?.type === "editIncontro" ? dialogMode.incontro : null}
        onClose={closeDialog}
      />

      {/* ── Add Convocazione dialog ── */}
      <AddConvocazioneDialog
        isOpen={dialogMode?.type === "addConvocazione"}
        onClose={closeDialog}
        partecipazioni={partecipazioni}
      />

      {/* ── Add Documento dialog ── */}
      <AddDocumentoDialog
        isOpen={dialogMode?.type === "addDocumento"}
        onClose={closeDialog}
        documentiTipi={documentiTipi}
      />

      {/* ── Edit Documento dialog ── */}
      <EditDocumentoDialog
        isOpen={dialogMode?.type === "editDocumento"}
        onClose={closeDialog}
        documento={dialogMode?.type === "editDocumento" ? dialogMode.documento : { id: "", tipo: "", tipo_id: "", descrizione: "", file_url: "", link_legacy: "" }}
        documentiTipi={documentiTipi}
      />

      {/* ── Add Fattura dialog ── */}
      <AddFatturaDialog
        isOpen={dialogMode?.type === "addFattura"}
        onClose={closeDialog}
      />
    </div>
  );
}
