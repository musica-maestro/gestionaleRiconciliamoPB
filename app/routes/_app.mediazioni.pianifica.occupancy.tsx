import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

const TZ = "Europe/Rome";

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

function romeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

/** Occupancy of existing incontri for selected dates. Keys: "YYYY-MM-DD|HH:MM". */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);

  const url = new URL(request.url);
  const dates = (url.searchParams.get("dates") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  if (dates.length === 0) {
    return json({ occupancy: {} as Record<string, number>, dayTotals: {} as Record<string, number> });
  }

  const fromUtc = italianLocalToUTC(`${dates[0]}T00:00`);
  const toUtc = italianLocalToUTC(`${dates[dates.length - 1]}T23:59`);
  const dateSet = new Set(dates);

  try {
    const rows = await pb.collection("incontri").getFullList({
      filter: `data_programmazione >= "${fromUtc}" && data_programmazione <= "${toUtc}"`,
      expand: "mediazione",
      requestKey: null,
    });

    const occupancy: Record<string, number> = {};
    const dayTotals: Record<string, number> = {};
    for (const d of dates) dayTotals[d] = 0;

    for (const raw of rows as Record<string, unknown>[]) {
      const mediazione = (raw.expand as { mediazione?: { is_deleted?: boolean } } | undefined)?.mediazione;
      if (mediazione?.is_deleted) continue;
      const startIso = String(raw.data_programmazione ?? "");
      if (!startIso) continue;
      const start = new Date(startIso.includes("T") ? startIso : startIso.replace(" ", "T"));
      if (Number.isNaN(start.getTime())) continue;
      const { date, time } = romeParts(start);
      if (!dateSet.has(date)) continue;
      const key = `${date}|${time}`;
      occupancy[key] = (occupancy[key] ?? 0) + 1;
      dayTotals[date] = (dayTotals[date] ?? 0) + 1;
    }

    return json({ occupancy, dayTotals });
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : "Errore",
        occupancy: {} as Record<string, number>,
        dayTotals: {} as Record<string, number>,
      },
      { status: 500 },
    );
  }
}
