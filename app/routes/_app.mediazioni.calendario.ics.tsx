import type { LoaderFunctionArgs } from "@remix-run/node";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

const TZ = "Europe/Rome";
const DEFAULT_DURATION_MIN = 30;

function italianLocalToUTC(localStr: string): string {
  const [datePart, timePart] = localStr.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = (timePart ?? "00:00").split(":").map(Number);
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
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
    const fh = get("hour");
    return Date.UTC(get("year"), get("month") - 1, get("day"), fh >= 24 ? 0 : fh, get("minute"), get("second"));
  };
  const offsetMs = epochFromParts(approxEpoch, TZ) - epochFromParts(approxEpoch, "UTC");
  return new Date(approxEpoch - offsetMs).toISOString().replace("T", " ").slice(0, 19) + ".000Z";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** UTC Date → ICS UTC timestamp YYYYMMDDTHHMMSSZ */
function toIcsUtc(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    "Z"
  );
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  parts.push(line.slice(0, 75));
  let rest = line.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  const { pb } = await createPB(request);
  const url = new URL(request.url);

  const canFilterMediatore = role === "admin" || role === "manager";
  const mediatoreFilter = canFilterMediatore ? url.searchParams.get("mediatore")?.trim() ?? "" : "";

  const now = new Date();
  const fromYmd = ymd(addDays(now, -30));
  const toYmd = ymd(addDays(now, 180));
  const fromUtc = italianLocalToUTC(`${fromYmd}T00:00`);
  const toUtc = italianLocalToUTC(`${toYmd}T23:59`);

  const filterParts = [
    `data_programmazione >= "${fromUtc}"`,
    `data_programmazione <= "${toUtc}"`,
  ];
  if (role === "mediatore") {
    filterParts.push(`mediazione.mediatore = "${user.id}"`);
  } else if (mediatoreFilter) {
    filterParts.push(`mediazione.mediatore = "${mediatoreFilter}"`);
  }

  const incontri = await pb.collection("incontri").getFullList({
    filter: filterParts.join(" && "),
    expand: "mediazione,mediazione.mediatore",
    sort: "data_programmazione",
    requestKey: null,
  });

  const mediazioneIds = [
    ...new Set(
      (incontri as { mediazione?: string }[])
        .map((i) => String(i.mediazione ?? ""))
        .filter(Boolean),
    ),
  ];

  const partiByMediazione = new Map<
    string,
    { parte: string; controparte: string; avvocati: string }
  >();
  if (mediazioneIds.length > 0) {
    const CHUNK = 40;
    for (let i = 0; i < mediazioneIds.length; i += CHUNK) {
      const chunk = mediazioneIds.slice(i, i + CHUNK);
      const rows = (await pb.collection("mediazioni_view").getFullList({
        filter: chunk.map((id) => `id = "${id}"`).join(" || "),
        fields: "id,istanti_testo,chiamati_testo,avvocati_testo",
        requestKey: null,
      })) as {
        id: string;
        istanti_testo?: string;
        chiamati_testo?: string;
        avvocati_testo?: string;
      }[];
      for (const row of rows) {
        partiByMediazione.set(row.id, {
          parte: row.istanti_testo ? String(row.istanti_testo).trim() : "",
          controparte: row.chiamati_testo ? String(row.chiamati_testo).trim() : "",
          avvocati: row.avvocati_testo ? String(row.avvocati_testo).trim() : "",
        });
      }
    }
  }

  const origin = url.origin;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Riconciliamo//Calendario Mediazioni//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Riconciliamo incontri",
    `X-WR-TIMEZONE:${TZ}`,
  ];

  const stamp = toIcsUtc(now);

  for (const raw of incontri as Record<string, unknown>[]) {
    const mediazione = (raw.expand as { mediazione?: Record<string, unknown> } | undefined)?.mediazione;
    if (!mediazione || mediazione.is_deleted) continue;
    const startIso = String(raw.data_programmazione ?? "");
    if (!startIso) continue;
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) continue;

    let end: Date;
    const inizioEff = raw.data_inizio_effettiva ? new Date(String(raw.data_inizio_effettiva)) : null;
    const fineEff = raw.data_fine_effettiva ? new Date(String(raw.data_fine_effettiva)) : null;
    if (
      inizioEff &&
      fineEff &&
      !Number.isNaN(inizioEff.getTime()) &&
      !Number.isNaN(fineEff.getTime()) &&
      fineEff > inizioEff
    ) {
      end = fineEff;
    } else {
      end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
    }

    const mediazioneId = String(mediazione.id ?? raw.mediazione);
    const rgm = String(mediazione.rgm ?? "Incontro");
    const oggetto = String(mediazione.oggetto ?? "");
    const parti = partiByMediazione.get(mediazioneId);
    const mediatoreExp = mediazione.expand as
      | { mediatore?: { name?: string; email?: string } }
      | undefined;
    const mediatoreName = mediatoreExp?.mediatore?.name || mediatoreExp?.mediatore?.email || "";

    const descParts = [
      oggetto && `Oggetto: ${oggetto}`,
      parti?.parte && `Parte: ${parti.parte}`,
      parti?.controparte && `Controparte: ${parti.controparte}`,
      parti?.avvocati && `Avvocati: ${parti.avvocati}`,
      mediatoreName && `Mediatore: ${mediatoreName}`,
      `${origin}/mediazioni/${mediazioneId}?tab=incontri`,
    ].filter(Boolean);

    const uid = `incontro-${raw.id}@riconciliamo`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcsUtc(start)}`);
    lines.push(`DTEND:${toIcsUtc(end)}`);
    lines.push(foldLine(`SUMMARY:${icsEscape(`Mediazione ${rgm}`)}`));
    if (descParts.length) {
      lines.push(foldLine(`DESCRIPTION:${icsEscape(descParts.join("\\n"))}`));
    }
    lines.push(foldLine(`URL:${origin}/mediazioni/${mediazioneId}?tab=incontri`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  const body = lines.join("\r\n") + "\r\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="riconciliamo-incontri.ics"',
      "Cache-Control": "no-store",
    },
  });
}
