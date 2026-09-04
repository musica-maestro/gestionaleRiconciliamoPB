import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import type { MetaFunction } from "@remix-run/node";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Menu, Plus } from "lucide-react";
import { getCurrentRole, requireUser } from "~/lib/auth.server";
import {
  CALENDAR_COLOR_DA_NOTIFICARE,
  CALENDAR_COLOR_NO_ESITO,
  ESITO_FINALE_COLORS,
  ESITO_FINALE_VALUES,
  calendarEventColor,
  calendarEventTextColor,
} from "~/lib/esito-finale";
import { createPB } from "~/lib/pocketbase.server";

export const meta: MetaFunction = () => [{ title: "Calendario mediazioni" }];

const TZ = "Europe/Rome";
const DEFAULT_DURATION_MIN = 30;
const DAY_START_MIN = 5 * 60;
const DAY_END_MIN = 23 * 60;
const HOUR_H_DAY = 84;
const HOUR_H_WEEK = 68;
/** Compact day block — enough for 2 horizontal lines. */
const DAY_EVENT_MIN_H = 40;
const SNAP_MIN = 15;
const DRAG_MIME = "application/x-incontro-id";
const VIEWS = ["day", "week", "month"] as const;
type View = (typeof VIEWS)[number];

const GCAL_COLORS = [
  "#7986cb",
  "#33b679",
  "#8e24aa",
  "#e67c73",
  "#f6bf26",
  "#f4511e",
  "#039be5",
  "#0b8043",
  "#d50000",
  "#ff7043",
  "#00acc1",
  "#7cb342",
] as const;

/** Lifecycle fase for sidebar filters. */
const FASI = ["pianificata", "notificata", "chiusa"] as const;
type Fase = (typeof FASI)[number];

const FASE_LABELS: Record<Fase, string> = {
  pianificata: "Pianificate",
  notificata: "Notificate",
  chiusa: "Chiuse",
};

const FASE_LABELS_SINGULAR: Record<Fase, string> = {
  pianificata: "Pianificata",
  notificata: "Notificata",
  chiusa: "Chiusa",
};

const COLOR_LEGEND: { id: string; label: string; color: string }[] = [
  { id: "da_notificare", label: "Da notificare", color: CALENDAR_COLOR_DA_NOTIFICARE },
  { id: "senza_esito", label: "Senza esito", color: CALENDAR_COLOR_NO_ESITO },
  ...ESITO_FINALE_VALUES.map((label) => ({
    id: label,
    label,
    color: ESITO_FINALE_COLORS[label],
  })),
];

/** Chiusa = data chiusura + esito valorizzato. */
const FILTER_CHIUSE =
  `(mediazione.data_chiusura != "" && mediazione.data_chiusura != null && mediazione.esito_finale != "" && mediazione.esito_finale != null)`;
const FILTER_APERTE =
  `(mediazione.data_chiusura = "" || mediazione.data_chiusura = null || mediazione.esito_finale = "" || mediazione.esito_finale = null)`;

function isMediazioneChiusa(mediazione: {
  data_chiusura?: unknown;
  esito_finale?: unknown;
}) {
  const dataChiusura = mediazione.data_chiusura
    ? String(mediazione.data_chiusura).trim()
    : "";
  const esito = mediazione.esito_finale ? String(mediazione.esito_finale).trim() : "";
  return Boolean(dataChiusura && esito);
}

function faseOf(mediazione: {
  stato?: unknown;
  data_chiusura?: unknown;
  esito_finale?: unknown;
}): Fase | "altro" {
  if (isMediazioneChiusa(mediazione)) return "chiusa";
  const stato = String(mediazione.stato ?? "");
  if (stato === "da_notificare" || stato === "pianificata") return "pianificata";
  if (stato === "aperta") return "notificata";
  return "altro";
}

type CalendarEvent = {
  id: string;
  mediazioneId: string;
  startMs: number;
  endMs: number;
  dayKey: string;
  timeLabel: string;
  endTimeLabel: string;
  rgm: string;
  oggetto: string;
  stato: string;
  fase: Fase | "altro";
  esitoFinale: string;
  mediatoreId: string;
  mediatoreName: string;
  colorIndex: number;
  parte: string;
  controparte: string;
  avvocati: string;
  adesione: boolean;
};

/** Same priority as calendarEventColor — used to toggle legend filters. */
function colorKeyOf(e: Pick<CalendarEvent, "esitoFinale" | "stato" | "adesione">): string {
  const esito = e.esitoFinale.trim();
  if (esito && esito in ESITO_FINALE_COLORS) return esito;
  if (e.stato === "da_notificare" || e.stato === "pianificata") return "da_notificare";
  if (!esito && e.adesione === false) return "Nessuna adesione";
  return "senza_esito";
}

type LaidOutEvent = CalendarEvent & { col: number; cols: number };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function startOfWeekMonday(d: Date) {
  const out = new Date(d);
  const day = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

function formatPartsInRome(date: Date) {
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
  const hourRaw = get("hour") === "24" ? "00" : get("hour");
  return {
    dayKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(hourRaw),
    minute: Number(get("minute")),
    timeLabel: `${hourRaw}:${get("minute")}`,
  };
}

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

function minutesFromMidnightRome(date: Date) {
  const { hour, minute } = formatPartsInRome(date);
  return hour * 60 + minute;
}

function hashColorIndex(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % GCAL_COLORS.length;
}

function colorOf(index: number) {
  return GCAL_COLORS[index % GCAL_COLORS.length];
}

function eventColor(e: Pick<CalendarEvent, "esitoFinale" | "stato" | "adesione">) {
  return calendarEventColor({
    esitoFinale: e.esitoFinale,
    stato: e.stato,
    adesione: e.adesione,
  });
}

function layoutDayEvents(events: CalendarEvent[]): LaidOutEvent[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.rgm.localeCompare(b.rgm),
  );
  const colEnds: number[] = [];
  const placed: LaidOutEvent[] = [];

  for (const ev of sorted) {
    let col = colEnds.findIndex((end) => end <= ev.startMs);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(ev.endMs);
    } else {
      colEnds[col] = ev.endMs;
    }
    placed.push({ ...ev, col, cols: 1 });
  }

  for (let i = 0; i < placed.length; i++) {
    let clusterEnd = placed[i].endMs;
    let maxCol = placed[i].col;
    let j = i;
    while (j + 1 < placed.length && placed[j + 1].startMs < clusterEnd) {
      j++;
      clusterEnd = Math.max(clusterEnd, placed[j].endMs);
      maxCol = Math.max(maxCol, placed[j].col);
    }
    const cols = maxCol + 1;
    for (let k = i; k <= j; k++) placed[k].cols = cols;
    i = j;
  }

  return placed;
}

function rangeForView(view: View, anchor: Date): { fromYmd: string; toYmd: string } {
  if (view === "day") {
    const key = ymd(anchor);
    return { fromYmd: key, toYmd: key };
  }
  if (view === "week") {
    const start = startOfWeekMonday(anchor);
    return { fromYmd: ymd(start), toYmd: ymd(addDays(start, 4)) };
  }
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const gridStart = startOfWeekMonday(monthStart);
  const gridEnd = addDays(startOfWeekMonday(monthEnd), 6);
  return { fromYmd: ymd(gridStart), toYmd: ymd(gridEnd) };
}

function eventTooltip(e: CalendarEvent) {
  const faseLabel = e.fase === "altro" ? null : FASE_LABELS_SINGULAR[e.fase];
  return [
    `${e.timeLabel}–${e.endTimeLabel}`,
    e.rgm,
    e.esitoFinale || faseLabel,
    e.parte && `Parte: ${e.parte}`,
    e.controparte && `Controparte: ${e.controparte}`,
    e.avvocati && `Avvocati: ${e.avvocati}`,
    e.mediatoreName,
    "Trascina per spostare (stesso orario = affiancati)",
  ]
    .filter(Boolean)
    .join(" · ");
}

function snapMins(mins: number, step = SNAP_MIN) {
  const snapped = Math.round(mins / step) * step;
  return Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - step, snapped));
}

function minsToLocal(dayKey: string, mins: number) {
  return `${dayKey}T${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

function localRomeToMs(dayKey: string, mins: number) {
  const utc = italianLocalToUTC(minsToLocal(dayKey, mins));
  return new Date(utc.replace(" ", "T")).getTime();
}

function withNewStart(e: CalendarEvent, newStartMs: number): CalendarEvent {
  const dur = Math.max(e.endMs - e.startMs, DEFAULT_DURATION_MIN * 60_000);
  const end = new Date(newStartMs + dur);
  const startParts = formatPartsInRome(new Date(newStartMs));
  const endParts = formatPartsInRome(end);
  return {
    ...e,
    startMs: newStartMs,
    endMs: end.getTime(),
    dayKey: startParts.dayKey,
    timeLabel: startParts.timeLabel,
    endTimeLabel: endParts.timeLabel,
  };
}

type RescheduleOp = { type: "move"; id: string; dayKey: string; mins: number };

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request);
  const { pb } = await createPB(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "move") {
      const id = String(formData.get("id") ?? "").trim();
      const local = String(formData.get("local") ?? "").trim();
      if (!id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
        return json({ ok: false, error: "Spostamento non valido" }, 400);
      }
      await pb.collection("incontri").update(id, {
        data_programmazione: italianLocalToUTC(local),
      });
      return json({ ok: true, intent: "move" as const });
    }

    return json({ ok: false, error: "Intent non valido" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore aggiornamento incontro";
    return json({ ok: false, error: message }, 500);
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = getCurrentRole(user);
  const { pb } = await createPB(request);
  const url = new URL(request.url);

  const viewParam = url.searchParams.get("view") ?? "day";
  const view: View = (VIEWS as readonly string[]).includes(viewParam) ? (viewParam as View) : "day";

  const now = new Date();
  const dateParam = url.searchParams.get("date")?.trim();
  let anchor: Date;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    anchor = parseYmd(dateParam);
  } else {
    anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const canFilterMediatore = role === "admin" || role === "manager";
  const adesioneParam = url.searchParams.get("adesione")?.trim() ?? "";
  const adesioneFilter =
    adesioneParam === "si" || adesioneParam === "no" ? adesioneParam : "";
  const faseParam = url.searchParams.get("fase")?.trim() ?? "";
  const faseFilter: Fase | "" = (FASI as readonly string[]).includes(faseParam)
    ? (faseParam as Fase)
    : "";
  const { fromYmd, toYmd } = rangeForView(view, anchor);
  const fromUtc = italianLocalToUTC(`${fromYmd}T00:00`);
  const toUtc = italianLocalToUTC(`${toYmd}T23:59`);

  const filterParts = [
    `data_programmazione >= "${fromUtc}"`,
    `data_programmazione <= "${toUtc}"`,
  ];
  if (role === "mediatore") {
    filterParts.push(`mediazione.mediatore = "${user.id}"`);
  }
  if (adesioneFilter === "si") {
    filterParts.push("mediazione.adesione = true");
  } else if (adesioneFilter === "no") {
    filterParts.push("mediazione.adesione = false");
  }
  if (faseFilter === "pianificata") {
    filterParts.push(
      `${FILTER_APERTE} && (mediazione.stato = "da_notificare" || mediazione.stato = "pianificata")`,
    );
  } else if (faseFilter === "notificata") {
    filterParts.push(`${FILTER_APERTE} && mediazione.stato = "aperta"`);
  } else if (faseFilter === "chiusa") {
    filterParts.push(FILTER_CHIUSE);
  }

  const [incontri, mediatoriList] = await Promise.all([
    pb.collection("incontri").getFullList({
      filter: filterParts.join(" && "),
      expand: "mediazione,mediazione.mediatore",
      sort: "data_programmazione",
      requestKey: null,
    }),
    canFilterMediatore
      ? pb.collection("users").getFullList({
          filter: 'ruolo_corrente = "mediatore" || ruoli ?~ "mediatore"',
          sort: "name,email",
          fields: "id,name,email,stato",
          requestKey: null,
        })
      : Promise.resolve([]),
  ]);

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
    const chunks: string[][] = [];
    for (let i = 0; i < mediazioneIds.length; i += CHUNK) {
      chunks.push(mediazioneIds.slice(i, i + CHUNK));
    }
    const viewRows = (
      await Promise.all(
        chunks.map((chunk) =>
          pb.collection("mediazioni_view").getFullList({
            filter: chunk.map((id) => `id = "${id}"`).join(" || "),
            fields: "id,istanti_testo,chiamati_testo,avvocati_testo",
            requestKey: null,
          }),
        ),
      )
    ).flat() as {
      id: string;
      istanti_testo?: string;
      chiamati_testo?: string;
      avvocati_testo?: string;
    }[];
    for (const row of viewRows) {
      partiByMediazione.set(row.id, {
        parte: row.istanti_testo ? String(row.istanti_testo).trim() : "",
        controparte: row.chiamati_testo ? String(row.chiamati_testo).trim() : "",
        avvocati: row.avvocati_testo ? String(row.avvocati_testo).trim() : "",
      });
    }
  }

  const colorByMediatore = new Map<string, number>();
  const events: CalendarEvent[] = [];

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

    const mediatoreExp = mediazione.expand as
      | { mediatore?: { id?: string; name?: string; email?: string } }
      | undefined;
    const mediatoreId = String(mediazione.mediatore ?? mediatoreExp?.mediatore?.id ?? "");
    const mediatoreName =
      mediatoreExp?.mediatore?.name ||
      mediatoreExp?.mediatore?.email ||
      (mediatoreId ? "Mediatore" : "Non assegnato");

    if (!colorByMediatore.has(mediatoreId)) {
      colorByMediatore.set(mediatoreId, hashColorIndex(mediatoreId || "none"));
    }

    const startParts = formatPartsInRome(start);
    const endParts = formatPartsInRome(end);
    const mediazioneId = String(mediazione.id ?? raw.mediazione);
    const parti = partiByMediazione.get(mediazioneId) ?? {
      parte: "",
      controparte: "",
      avvocati: "",
    };

    const fase = faseOf(mediazione);
    const esitoFinale = String(mediazione.esito_finale ?? "").trim();

    events.push({
      id: String(raw.id),
      mediazioneId,
      startMs: start.getTime(),
      endMs: end.getTime(),
      dayKey: startParts.dayKey,
      timeLabel: startParts.timeLabel,
      endTimeLabel: endParts.timeLabel,
      rgm: String(mediazione.rgm ?? "—"),
      oggetto: String(mediazione.oggetto ?? ""),
      stato: String(mediazione.stato ?? ""),
      fase,
      esitoFinale,
      mediatoreId,
      mediatoreName,
      colorIndex: colorByMediatore.get(mediatoreId)!,
      parte: parti.parte,
      controparte: parti.controparte,
      avvocati: parti.avvocati,
      adesione: Boolean(mediazione.adesione),
    });
  }

  const mediatori = (
    canFilterMediatore
      ? (mediatoriList as { id: string; name?: string; email?: string; stato?: string }[])
          .filter(
            (u) =>
              String(u.stato ?? "").toLowerCase() !== "false" &&
              String(u.stato ?? "") !== "inattivo",
          )
          .map((u) => ({
            id: u.id,
            name: u.name || u.email || u.id,
            colorIndex: colorByMediatore.get(u.id) ?? hashColorIndex(u.id),
          }))
      : [
          {
            id: user.id,
            name: user.name || user.email || "Io",
            colorIndex: colorByMediatore.get(user.id) ?? hashColorIndex(user.id),
          },
        ]
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Ensure mediatori that have events but aren't in the list still appear as tags
  for (const e of events) {
    if (!e.mediatoreId) continue;
    if (mediatori.some((m) => m.id === e.mediatoreId)) continue;
    mediatori.push({
      id: e.mediatoreId,
      name: e.mediatoreName,
      colorIndex: e.colorIndex,
    });
  }
  mediatori.sort((a, b) => a.name.localeCompare(b.name));

  return json({
    events,
    view,
    date: ymd(anchor),
    canFilterMediatore,
    mediatori,
    adesioneFilter,
    faseFilter,
  });
}

function useNowTick(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function MiniMonth({
  anchor,
  selectedKey,
  onSelect,
  onShiftMonth,
}: {
  anchor: Date;
  selectedKey: string;
  onSelect: (key: string) => void;
  onShiftMonth: (delta: number) => void;
}) {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeekMonday(monthStart);
  const todayKey = ymd(new Date());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = addDays(gridStart, i);
    return {
      key: ymd(d),
      day: d.getDate(),
      inMonth: d.getMonth() === anchor.getMonth(),
    };
  });

  return (
    <div className="px-3 pt-1 pb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[var(--cal-text)] capitalize px-1">
          {anchor.toLocaleDateString("it-IT", { month: "long", year: "numeric" })}
        </span>
        <div className="flex">
          <button
            type="button"
            className="p-1 rounded-full text-[var(--cal-text)] hover:bg-[var(--cal-hover)]"
            onClick={() => onShiftMonth(-1)}
            aria-label="Mese precedente"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="p-1 rounded-full text-[var(--cal-text)] hover:bg-[var(--cal-hover)]"
            onClick={() => onShiftMonth(1)}
            aria-label="Mese successivo"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-[var(--cal-muted)] mb-1">
        {["L", "M", "M", "G", "V", "S", "D"].map((d, i) => (
          <div key={`${d}${i}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((c) => {
          const isSelected = c.key === selectedKey;
          const isToday = c.key === todayKey;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelect(c.key)}
              className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs tabular-nums ${
                isSelected
                  ? "bg-[var(--cal-accent)] text-[var(--cal-accent-on)] font-medium"
                  : isToday
                    ? "text-[var(--cal-accent)] font-medium"
                    : c.inMonth
                      ? "text-[var(--cal-text)] hover:bg-[var(--cal-hover)]"
                      : "text-[var(--cal-muted)] hover:bg-[var(--cal-hover)]"
              }`}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NowLine({ dayKey, nowMs, hourH }: { dayKey: string; nowMs: number; hourH: number }) {
  const parts = formatPartsInRome(new Date(nowMs));
  if (parts.dayKey !== dayKey) return null;
  const mins = parts.hour * 60 + parts.minute;
  if (mins < DAY_START_MIN || mins > DAY_END_MIN) return null;
  const top = ((mins - DAY_START_MIN) / 60) * hourH;
  return (
    <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top }}>
      <div className="relative">
        <span className="absolute -left-[5px] -top-[5px] h-[10px] w-[10px] rounded-full bg-[var(--cal-now)]" />
        <div className="h-[2px] bg-[var(--cal-now)]" />
      </div>
    </div>
  );
}

function EventBlock({
  e,
  density,
  hourH,
  draggingId,
  onDragStartEvent,
  onDragEndEvent,
  onPreviewSlot,
  onMoveToEventSlot,
}: {
  e: LaidOutEvent;
  density: "day" | "week";
  hourH: number;
  draggingId: string | null;
  onDragStartEvent: (id: string) => void;
  onDragEndEvent: () => void;
  onPreviewSlot: (dayKey: string, mins: number) => void;
  /** Dropping on an event places the dragged one on the same start time (side by side). */
  onMoveToEventSlot: (draggedId: string, target: LaidOutEvent) => void;
}) {
  const navigate = useNavigate();
  const suppressClick = useRef(false);
  const startMin = minutesFromMidnightRome(new Date(e.startMs));
  const endMin = minutesFromMidnightRome(new Date(e.endMs));
  if (startMin >= DAY_END_MIN || endMin <= DAY_START_MIN) return null;
  const clampedStart = Math.max(startMin, DAY_START_MIN);
  const clampedEnd = Math.min(Math.max(endMin, clampedStart + 15), DAY_END_MIN);
  const top = ((clampedStart - DAY_START_MIN) / 60) * hourH;
  const naturalH = ((clampedEnd - clampedStart) / 60) * hourH - 2;
  const hPx = Math.max(naturalH, density === "day" ? DAY_EVENT_MIN_H : 18);
  const widthPct = 100 / e.cols;
  const leftPct = e.col * widthPct;
  const color = eventColor(e);
  const textColor = calendarEventTextColor(color);
  const isDragging = draggingId === e.id;

  const parties = [
    e.parte && `Ist. ${e.parte}`,
    e.controparte && `Chiam. ${e.controparte}`,
    e.avvocati && `Avv. ${e.avvocati}`,
    e.mediatoreName && `Med. ${e.mediatoreName}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role="link"
      tabIndex={0}
      draggable
      data-event-id={e.id}
      onDragStart={(ev) => {
        suppressClick.current = true;
        ev.dataTransfer.setData(DRAG_MIME, e.id);
        ev.dataTransfer.setData("text/plain", e.id);
        ev.dataTransfer.effectAllowed = "move";
        onDragStartEvent(e.id);
      }}
      onDragEnd={() => {
        onDragEndEvent();
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }}
      onDragOver={(ev) => {
        if (!draggingId || draggingId === e.id) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = "move";
        onPreviewSlot(e.dayKey, startMin);
      }}
      onDrop={(ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const draggedId =
          ev.dataTransfer.getData(DRAG_MIME) || ev.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === e.id) return;
        onMoveToEventSlot(draggedId, e);
      }}
      onClick={() => {
        if (suppressClick.current) return;
        navigate(`/mediazioni/${e.mediazioneId}?tab=incontri`);
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          navigate(`/mediazioni/${e.mediazioneId}?tab=incontri`);
        }
      }}
      className={`absolute z-10 overflow-hidden rounded-md px-1.5 py-1 hover:z-30 hover:brightness-110 shadow-sm cursor-grab active:cursor-grabbing transition-[top,left,width,height,opacity,filter] duration-300 ease-out ${
        isDragging ? "opacity-40" : ""
      }`}
      style={{
        top,
        height: hPx,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: color,
        color: textColor,
      }}
      title={eventTooltip(e)}
    >
      {density === "day" ? (
        <div className="text-[11px] leading-tight space-y-0.5 pointer-events-none">
          <div className="truncate font-semibold">
            <span className="tabular-nums">
              {e.timeLabel}–{e.endTimeLabel}
            </span>
            <span className="opacity-80 font-normal"> · </span>
            RGM {e.rgm}
            {e.oggetto ? (
              <>
                <span className="opacity-80 font-normal"> · </span>
                <span className="font-normal opacity-95">{e.oggetto}</span>
              </>
            ) : null}
          </div>
          {parties ? <div className="truncate opacity-95">{parties}</div> : null}
        </div>
      ) : (
        <div className="text-[10px] leading-tight font-medium truncate pointer-events-none">
          <span className="tabular-nums opacity-90">{e.timeLabel}</span> {e.rgm}
          {hPx > 28 && e.parte ? (
            <span className="opacity-85"> · {e.parte}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DayAgendaPanel({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-4 text-sm text-[var(--cal-muted)] text-center">
        Nessun incontro in questo giorno
      </div>
    );
  }

  return (
    <ul className="h-full overflow-y-auto divide-y divide-[var(--cal-border)]">
      {events.map((e) => {
        const color = eventColor(e);
        const meta = [
          e.esitoFinale || (e.fase !== "altro" && FASE_LABELS_SINGULAR[e.fase]),
          e.parte && `Istante ${e.parte}`,
          e.controparte && `Chiamato ${e.controparte}`,
          e.avvocati && `Avvocati ${e.avvocati}`,
          e.mediatoreName && `Mediatore ${e.mediatoreName}`,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={e.id}>
            <Link
              to={`/mediazioni/${e.mediazioneId}?tab=incontri`}
              className="block px-3 py-2.5 hover:bg-[var(--cal-hover)]"
            >
              <div className="flex items-start gap-2.5">
                <span
                  className="mt-1 h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1 text-sm leading-snug">
                  <div className="truncate">
                    <span className="font-semibold tabular-nums text-[var(--cal-text)]">
                      {e.timeLabel}–{e.endTimeLabel}
                    </span>
                    <span className="mx-1.5 font-medium text-[var(--cal-accent)]">RGM {e.rgm}</span>
                    {e.oggetto ? (
                      <span className="text-[var(--cal-text)] opacity-80">{e.oggetto}</span>
                    ) : null}
                  </div>
                  {meta ? (
                    <div className="mt-0.5 truncate text-[12px] text-[var(--cal-muted)]">{meta}</div>
                  ) : null}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TimeGrid({
  days,
  events,
  density,
  nowMs,
  onSelectDay,
  onReschedule,
  busy,
}: {
  days: { key: string; date: Date; label: string }[];
  events: CalendarEvent[];
  density: "day" | "week";
  nowMs: number;
  onSelectDay: (key: string) => void;
  onReschedule: (op: RescheduleOp) => void;
  busy: boolean;
}) {
  const hourH = density === "day" ? HOUR_H_DAY : HOUR_H_WEEK;
  const hours: number[] = [];
  for (let h = DAY_START_MIN / 60; h < DAY_END_MIN / 60; h++) hours.push(h);
  const height = ((DAY_END_MIN - DAY_START_MIN) / 60) * hourH;
  const todayKey = ymd(new Date(nowMs));

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ dayKey: string; mins: number } | null>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const byDayLaid = useMemo(() => {
    const map: Record<string, LaidOutEvent[]> = {};
    for (const d of days) {
      map[d.key] = layoutDayEvents(events.filter((e) => e.dayKey === d.key));
    }
    return map;
  }, [days, events]);

  const clearDragUi = useCallback(() => {
    setDraggingId(null);
    setPreview(null);
  }, []);

  const minsFromPointer = (dayKey: string, clientY: number) => {
    const el = colRefs.current[dayKey];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top;
    const raw = DAY_START_MIN + (y / hourH) * 60;
    return snapMins(raw);
  };

  const previewTop =
    preview != null ? ((preview.mins - DAY_START_MIN) / 60) * hourH : null;

  return (
    <div
      className={`flex flex-col h-full min-h-0 overflow-auto ${busy ? "opacity-80 pointer-events-none" : ""}`}
    >
      <div
        className="grid sticky top-0 z-30 bg-[var(--cal-bg)] border-b border-[var(--cal-border)]"
        style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div />
        {days.map((d) => {
          const isToday = d.key === todayKey;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onSelectDay(d.key)}
              className="py-2 text-center"
            >
              <div
                className={`text-[11px] font-medium uppercase tracking-wide ${
                  isToday ? "text-[var(--cal-accent)]" : "text-[var(--cal-muted)]"
                }`}
              >
                {d.label}
              </div>
              <div
                className={`mx-auto mt-0.5 flex h-11 w-11 items-center justify-center rounded-full text-[26px] font-normal tabular-nums ${
                  isToday ? "bg-[var(--cal-accent)] text-[var(--cal-accent-on)]" : "text-[var(--cal-text)]"
                }`}
              >
                {d.date.getDate()}
              </div>
            </button>
          );
        })}
      </div>

      <div
        className="grid relative"
        style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div className="relative border-r border-[var(--cal-border)]" style={{ height }}>
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-[var(--cal-muted)]"
              style={{ top: ((h * 60 - DAY_START_MIN) / 60) * hourH }}
            >
              {pad2(h)}:00
            </div>
          ))}
          {preview && previewTop != null ? (
            <div
              className="pointer-events-none absolute left-0 right-0 z-30"
              style={{ top: previewTop }}
            >
              <span className="absolute right-1 -translate-y-1/2 rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-sm">
                {pad2(Math.floor(preview.mins / 60))}:{pad2(preview.mins % 60)}
              </span>
            </div>
          ) : null}
        </div>

        {days.map((d) => (
          <div
            key={d.key}
            ref={(el) => {
              colRefs.current[d.key] = el;
            }}
            className="relative border-r border-[var(--cal-border)] last:border-r-0"
            style={{ height }}
            onDragOver={(ev) => {
              if (!draggingId) return;
              ev.preventDefault();
              ev.dataTransfer.dropEffect = "move";
              const mins = minsFromPointer(d.key, ev.clientY);
              if (mins != null) setPreview({ dayKey: d.key, mins });
            }}
            onDragLeave={(ev) => {
              if (!ev.currentTarget.contains(ev.relatedTarget as Node)) {
                setPreview((p) => (p?.dayKey === d.key ? null : p));
              }
            }}
            onDrop={(ev) => {
              ev.preventDefault();
              const draggedId =
                ev.dataTransfer.getData(DRAG_MIME) || ev.dataTransfer.getData("text/plain");
              if (!draggedId) {
                clearDragUi();
                return;
              }
              // Drop on another event: EventBlock already handled (same slot)
              if ((ev.target as HTMLElement).closest?.("[data-event-id]")) {
                clearDragUi();
                return;
              }
              const mins = minsFromPointer(d.key, ev.clientY);
              clearDragUi();
              if (mins == null) return;
              onReschedule({ type: "move", id: draggedId, dayKey: d.key, mins });
            }}
          >
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-[var(--cal-border)] pointer-events-none"
                style={{ top: i * hourH, height: hourH }}
              />
            ))}
            {preview?.dayKey === d.key && previewTop != null ? (
              <div
                className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-blue-500"
                style={{ top: previewTop }}
              />
            ) : null}
            {(byDayLaid[d.key] || []).map((e) => (
              <EventBlock
                key={e.id}
                e={e}
                density={density}
                hourH={hourH}
                draggingId={draggingId}
                onDragStartEvent={setDraggingId}
                onDragEndEvent={clearDragUi}
                onPreviewSlot={(dayKey, mins) => setPreview({ dayKey, mins })}
                onMoveToEventSlot={(draggedId, target) => {
                  clearDragUi();
                  const mins = minutesFromMidnightRome(new Date(target.startMs));
                  onReschedule({
                    type: "move",
                    id: draggedId,
                    dayKey: target.dayKey,
                    mins,
                  });
                }}
              />
            ))}
            <NowLine dayKey={d.key} nowMs={nowMs} hourH={hourH} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CalendarioMediazioniPage() {
  const { events, view, date, canFilterMediatore, mediatori, adesioneFilter, faseFilter } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [optimisticEvents, setOptimisticEvents] = useState<CalendarEvent[] | null>(null);
  const fetcher = useFetcher<typeof action>();
  const nowMs = useNowTick(view === "week" || view === "day");

  useEffect(() => {
    setOptimisticEvents(null);
  }, [events]);

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (fetcher.data && "ok" in fetcher.data && fetcher.data.ok === false) {
      setOptimisticEvents(null);
    }
  }, [fetcher.state, fetcher.data]);

  const displayEvents = optimisticEvents ?? events;
  const busy = fetcher.state !== "idle";
  const actionError =
    fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data && fetcher.data.ok === false
      ? String((fetcher.data as { error?: string }).error ?? "Errore nello spostamento")
      : null;

  const handleReschedule = useCallback(
    (op: RescheduleOp) => {
      const base = optimisticEvents ?? events;
      const nextMs = localRomeToMs(op.dayKey, op.mins);
      setOptimisticEvents(
        base.map((e) => (e.id === op.id ? withNewStart(e, nextMs) : e)),
      );
      fetcher.submit(
        {
          intent: "move",
          id: op.id,
          local: minsToLocal(op.dayKey, op.mins),
        },
        { method: "post" },
      );
    },
    [events, fetcher, optimisticEvents],
  );

  const anchor = parseYmd(date);
  const todayKey = ymd(new Date());

  // Multi-select mediatore tags: empty = all on
  const hiddenIds = useMemo(() => {
    const raw = searchParams.get("hide") ?? "";
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  }, [searchParams]);

  // Hidden color-legend keys; empty = all visible
  const hiddenColors = useMemo(() => {
    const raw = searchParams.get("hideColor") ?? "";
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  }, [searchParams]);

  const visibleEvents = useMemo(() => {
    return displayEvents.filter((e) => {
      if (canFilterMediatore && hiddenIds.has(e.mediatoreId)) return false;
      if (hiddenColors.has(colorKeyOf(e))) return false;
      return true;
    });
  }, [displayEvents, hiddenIds, hiddenColors, canFilterMediatore]);

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  };

  const toggleMediatore = (id: string) => {
    const next = new Set(hiddenIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateParams({ hide: next.size ? [...next].join(",") : null });
  };

  const toggleColor = (id: string) => {
    const next = new Set(hiddenColors);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateParams({ hideColor: next.size ? [...next].join(",") : null });
  };

  const selectAllColors = () => updateParams({ hideColor: null });

  const resetColorFilters = () => {
    updateParams({
      hideColor: null,
      adesione: null,
      fase: null,
    });
  };

  const shift = (delta: number) => {
    let next: Date;
    if (view === "day") next = addDays(anchor, delta);
    else if (view === "week") next = addDays(anchor, delta * 7);
    else next = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
    updateParams({ date: ymd(next) });
  };

  const headerLabel = useMemo(() => {
    if (view === "day") {
      return anchor.toLocaleDateString("it-IT", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
    if (view === "week") {
      const start = startOfWeekMonday(anchor);
      const end = addDays(start, 4);
      const sameMonth = start.getMonth() === end.getMonth();
      if (sameMonth) {
        return `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString("it-IT", {
          month: "long",
          year: "numeric",
        })}`;
      }
      return `${start.toLocaleDateString("it-IT", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return anchor.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  }, [anchor, view]);

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of visibleEvents) {
      if (!map[e.dayKey]) map[e.dayKey] = [];
      map[e.dayKey].push(e);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.startMs - b.startMs || a.rgm.localeCompare(b.rgm));
    }
    return map;
  }, [visibleEvents]);

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(anchor);
    return Array.from({ length: 5 }, (_, i) => {
      const d = addDays(start, i);
      return {
        key: ymd(d),
        date: d,
        label: d.toLocaleDateString("it-IT", { weekday: "short" }),
      };
    });
  }, [anchor]);

  const dayDays = useMemo(
    () => [
      {
        key: date,
        date: anchor,
        label: anchor.toLocaleDateString("it-IT", { weekday: "short" }),
      },
    ],
    [anchor, date],
  );

  const monthCells = useMemo(() => {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const gridStart = startOfWeekMonday(monthStart);
    const cells: { key: string; inMonth: boolean; day: number }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      cells.push({
        key: ymd(d),
        inMonth: d >= monthStart && d <= monthEnd,
        day: d.getDate(),
      });
      if (d >= monthEnd && (d.getDay() + 6) % 7 === 6 && i >= 27) break;
    }
    return cells;
  }, [anchor]);

  const miniAnchor = useMemo(() => {
    const m = searchParams.get("mini");
    if (m && /^\d{4}-\d{2}$/.test(m)) {
      const [y, mo] = m.split("-").map(Number);
      return new Date(y, mo - 1, 1);
    }
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  }, [anchor, searchParams]);

  const viewLabel = view === "day" ? "Giorno" : view === "week" ? "Settimana" : "Mese";

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full bg-[var(--cal-bg)] text-[var(--cal-text)] overflow-hidden">
      {/* Left sidebar */}
      <aside
        className={`shrink-0 flex flex-col border-r border-[var(--cal-border)] transition-[width] ${
          sidebarOpen ? "w-[260px]" : "w-0 overflow-hidden border-0"
        }`}
      >
        <div className="p-3">
          <Link
            to="/mediazioni/pianifica"
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--cal-hover)] hover:bg-[var(--cal-border)] pl-3 pr-5 py-3 text-sm font-medium text-[var(--cal-text)] shadow-md"
          >
            <Plus className="h-5 w-5 text-[var(--cal-accent)]" />
            Pianifica incontri
          </Link>
        </div>

        <MiniMonth
          anchor={miniAnchor}
          selectedKey={date}
          onSelect={(key) => updateParams({ date: key, view: view === "month" ? "day" : view })}
          onShiftMonth={(delta) => {
            const d = new Date(miniAnchor.getFullYear(), miniAnchor.getMonth() + delta, 1);
            updateParams({
              mini: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
            });
          }}
        />

        <div className="px-4 pt-2 pb-1 text-xs font-medium text-[var(--cal-muted)]">
          Filtri
        </div>
        <div className="px-3 pb-2 space-y-2">
          <select
            className="w-full rounded-lg border border-[var(--cal-border)] bg-[var(--cal-bg)] px-2 py-1.5 text-sm text-[var(--cal-text)]"
            value={adesioneFilter}
            onChange={(e) =>
              updateParams({ adesione: e.target.value || null })
            }
            aria-label="Filtra per adesione"
          >
            <option value="">Adesione: tutte</option>
            <option value="si">Solo con adesione</option>
            <option value="no">Senza adesione</option>
          </select>
          <select
            className="w-full rounded-lg border border-[var(--cal-border)] bg-[var(--cal-bg)] px-2 py-1.5 text-sm text-[var(--cal-text)]"
            value={faseFilter}
            onChange={(e) => updateParams({ fase: e.target.value || null })}
            aria-label="Filtra per stato mediazione"
          >
            <option value="">Stato: tutte</option>
            <option value="pianificata">Pianificate</option>
            <option value="notificata">Notificate</option>
            <option value="chiusa">Chiuse</option>
          </select>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className="flex-1 rounded-md border border-[var(--cal-border)] px-2 py-1.5 text-xs font-medium text-[var(--cal-text)] hover:bg-[var(--cal-hover)]"
              onClick={selectAllColors}
            >
              Seleziona tutti
            </button>
            <button
              type="button"
              className="flex-1 rounded-md border border-[var(--cal-border)] px-2 py-1.5 text-xs font-medium text-[var(--cal-text)] hover:bg-[var(--cal-hover)]"
              onClick={resetColorFilters}
            >
              Reset
            </button>
          </div>
          <div className="flex flex-col gap-0.5 pt-1 max-h-52 overflow-y-auto">
            {COLOR_LEGEND.map((item) => {
              const checked = !hiddenColors.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-[var(--cal-hover)] ${
                    checked ? "opacity-100" : "opacity-45"
                  }`}
                  onClick={() => toggleColor(item.id)}
                  aria-pressed={checked}
                  aria-label={`${checked ? "Nascondi" : "Mostra"} ${item.label}`}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-2"
                    style={{
                      backgroundColor: checked ? item.color : "transparent",
                      borderColor: item.color,
                    }}
                    aria-hidden
                  >
                    {checked && (
                      <svg
                        viewBox="0 0 16 16"
                        className="h-2.5 w-2.5"
                        style={{
                          fill: calendarEventTextColor(item.color),
                        }}
                      >
                        <path d="M6.2 11.4 2.8 8l1.1-1.1 2.3 2.3 5-5L12.3 5.3z" />
                      </svg>
                    )}
                  </span>
                  <span className="text-sm leading-snug text-[var(--cal-text)]">{item.label}</span>
                </button>
              );
            })}
          </div>
          <p className="pt-2 text-xs leading-snug text-[var(--cal-muted)]">
            Trascina un incontro sullo slot: sullo stesso orario di un altro restano affiancati.
          </p>
        </div>

        <div className="px-4 pt-2 pb-1 text-xs font-medium text-[var(--cal-muted)]">
          {canFilterMediatore ? "Mediatori" : "Il mio calendario"}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
          {mediatori.map((m) => {
            const checked = !hiddenIds.has(m.id);
            const color = colorOf(m.colorIndex);
            return (
              <button
                key={m.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--cal-hover)] disabled:cursor-default"
                onClick={() => {
                  if (!canFilterMediatore) return;
                  toggleMediatore(m.id);
                }}
                disabled={!canFilterMediatore}
              >
                <span
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border-2"
                  style={{
                    backgroundColor: checked ? color : "transparent",
                    borderColor: color,
                  }}
                  aria-hidden
                >
                  {checked && (
                    <svg viewBox="0 0 16 16" className="h-3 w-3 fill-white">
                      <path d="M6.2 11.4 2.8 8l1.1-1.1 2.3 2.3 5-5L12.3 5.3z" />
                    </svg>
                  )}
                </span>
                <span className="text-sm truncate text-[var(--cal-text)]">{m.name}</span>
              </button>
            );
          })}
        </div>

        <div className="px-3 pb-3">
          <a
            href="/mediazioni/calendario/ics"
            className="inline-flex items-center gap-2 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-text)]"
          >
            <Download className="h-3.5 w-3.5" />
            Esporta ICS
          </a>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {actionError ? (
          <div className="shrink-0 px-3 py-1.5 text-sm bg-red-50 text-red-700 border-b border-red-200">
            {actionError}
          </div>
        ) : null}
        <header className="flex flex-wrap items-center gap-1 sm:gap-2 px-2 sm:px-3 h-14 shrink-0 border-b border-[var(--cal-border)]">
          <button
            type="button"
            className="p-2 rounded-full hover:bg-[var(--cal-hover)] text-[var(--cal-text)]"
            aria-label="Menu"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Menu className="h-5 w-5" />
          </button>

          <span className="text-xl font-normal text-[var(--cal-text)] mr-1 hidden sm:inline">Calendario</span>

          <button
            type="button"
            className="ml-1 rounded-full border border-[var(--cal-border)] px-4 py-1.5 text-sm font-medium hover:bg-[var(--cal-hover)]"
            onClick={() => updateParams({ date: todayKey })}
          >
            Oggi
          </button>

          <button
            type="button"
            className="p-2 rounded-full hover:bg-[var(--cal-hover)]"
            aria-label="Precedente"
            onClick={() => shift(-1)}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="p-2 rounded-full hover:bg-[var(--cal-hover)]"
            aria-label="Successivo"
            onClick={() => shift(1)}
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <h2 className="text-xl sm:text-2xl font-normal capitalize text-[var(--cal-text)] ml-1 truncate">
            {headerLabel}
          </h2>

          <div className="flex-1" />

          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--cal-border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--cal-hover)]"
              onClick={() => setViewMenuOpen((v) => !v)}
            >
              {viewLabel}
              <ChevronDown className="h-4 w-4" />
            </button>
            {viewMenuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40"
                  aria-label="Chiudi"
                  onClick={() => setViewMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[10rem] rounded-lg border border-[var(--cal-border)] bg-[var(--cal-hover)] py-1 shadow-xl">
                  {(
                    [
                      { id: "day" as const, label: "Giorno" },
                      { id: "week" as const, label: "Settimana" },
                      { id: "month" as const, label: "Mese" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`block w-full text-left px-4 py-2 text-sm hover:bg-[var(--cal-border)] ${
                        view === opt.id ? "text-[var(--cal-accent)]" : "text-[var(--cal-text)]"
                      }`}
                      onClick={() => {
                        updateParams({ view: opt.id });
                        setViewMenuOpen(false);
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">
          {view === "day" && (
            <div className="h-full flex flex-col lg:flex-row min-h-0">
              <div className="flex-1 min-w-0 min-h-0 overflow-hidden basis-[55%] lg:basis-auto">
                <TimeGrid
                  days={dayDays}
                  events={visibleEvents}
                  density="day"
                  nowMs={nowMs}
                  onSelectDay={() => {}}
                  onReschedule={handleReschedule}
                  busy={busy}
                />
              </div>
              <aside className="w-full lg:max-w-[400px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--cal-border)] flex flex-col min-h-0 basis-[45%] lg:basis-auto lg:h-full max-h-[45vh] lg:max-h-none">
                <div className="px-4 py-3 border-b border-[var(--cal-border)] text-sm font-medium text-[var(--cal-text)] shrink-0">
                  Dettagli giornata
                  <span className="ml-2 text-[var(--cal-muted)] font-normal">
                    {(byDay[date] || []).length}
                  </span>
                </div>
                <div className="flex-1 min-h-0">
                  <DayAgendaPanel events={byDay[date] || []} />
                </div>
              </aside>
            </div>
          )}

          {view === "week" && (
            <TimeGrid
              days={weekDays}
              events={visibleEvents}
              density="week"
              nowMs={nowMs}
              onSelectDay={(key) => updateParams({ view: "day", date: key })}
              onReschedule={handleReschedule}
              busy={busy}
            />
          )}

          {view === "month" && (
            <div className="h-full overflow-auto flex flex-col">
              <div className="grid grid-cols-7 border-b border-[var(--cal-border)] shrink-0">
                {["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((d) => (
                  <div
                    key={d}
                    className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-[var(--cal-muted)]"
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 flex-1 auto-rows-fr">
                {monthCells.map((cell) => {
                  const dayEvents = byDay[cell.key] || [];
                  const isToday = cell.key === todayKey;
                  const maxVisible = 4;
                  const overflow = dayEvents.length - maxVisible;
                  return (
                    <div
                      key={cell.key}
                      className="min-h-[5.5rem] border-b border-r border-[var(--cal-border)] p-1"
                    >
                      <button
                        type="button"
                        className={`mb-0.5 mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs tabular-nums ${
                          isToday
                            ? "bg-[var(--cal-accent)] text-[var(--cal-accent-on)] font-medium"
                            : cell.inMonth
                              ? "text-[var(--cal-text)] hover:bg-[var(--cal-hover)]"
                              : "text-[var(--cal-muted)]"
                        }`}
                        onClick={() => updateParams({ view: "day", date: cell.key })}
                      >
                        {cell.day}
                      </button>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, maxVisible).map((e) => (
                          <Link
                            key={e.id}
                            to={`/mediazioni/${e.mediazioneId}?tab=incontri`}
                            className="flex items-center gap-1 truncate rounded px-0.5 text-[11px] leading-5 hover:bg-[var(--cal-hover)]"
                            title={eventTooltip(e)}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: eventColor(e) }}
                            />
                            <span className="tabular-nums text-[var(--cal-muted)]">{e.timeLabel}</span>
                            <span className="truncate text-[var(--cal-text)]">{e.rgm}</span>
                          </Link>
                        ))}
                        {overflow > 0 && (
                          <button
                            type="button"
                            className="w-full text-left px-1 text-[11px] text-[var(--cal-muted)] hover:bg-[var(--cal-hover)] rounded"
                            onClick={() => updateParams({ view: "day", date: cell.key })}
                          >
                            altri {overflow}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
