import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

export async function loader() {
  return redirect("/rubrica");
}

const ENTRY_TYPES = ["soggetto_fisica", "soggetto_giuridica", "avvocato"] as const;
type EntryType = (typeof ENTRY_TYPES)[number];

function isEntryType(s: string): s is EntryType {
  return ENTRY_TYPES.includes(s as EntryType);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  await requireUser(request);
  const { pb } = await createPB(request);
  const formData = await request.formData();

  const rawType = String(formData.get("_entryType") ?? "").trim();
  if (!isEntryType(rawType)) {
    return json({ error: "Tipo di voce non valido" }, 400);
  }

  const get = (name: string) => String(formData.get(name) ?? "").trim() || undefined;

  if (rawType === "avvocato") {
    try {
      const record = await pb.collection("avvocati").create({
        nome: get("nome"),
        cognome: get("cognome"),
        pec: get("pec"),
        telefono: get("telefono"),
        numero_tessera_foro: get("numero_tessera_foro"),
        foro_di_appartenenza: get("foro_di_appartenenza"),
      });
      return redirect(`/rubrica/avvocati/${record.id}`);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Errore durante la creazione";
      return json({ error: msg }, 400);
    }
  }

  const tipo = rawType === "soggetto_fisica" ? "Fisica" : "Giuridica";
  try {
    const record = await pb.collection("soggetti").create({
      tipo,
      nome: get("nome"),
      cognome: get("cognome"),
      codice_fiscale: get("codice_fiscale"),
      indirizzo_riga_1: get("indirizzo_riga_1"),
      indirizzo_riga_2: get("indirizzo_riga_2"),
      numero_civico: get("numero_civico"),
      comune: get("comune"),
      provincia: get("provincia"),
      cap: get("cap"),
      paese: get("paese"),
      email: get("email"),
      ragione_sociale: get("ragione_sociale"),
      piva: get("piva"),
      pec: get("pec"),
    });
    return redirect(`/rubrica/soggetti/${record.id}`);
  } catch (err: unknown) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: string }).message)
        : "Errore durante la creazione";
    return json({ error: msg }, 400);
  }
}

export default function RubricaCreateResource() {
  return null;
}
