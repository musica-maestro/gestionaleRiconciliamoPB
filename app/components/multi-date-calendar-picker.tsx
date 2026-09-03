import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (toYmd(d) !== ymd) return null;
  return d;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function startOfMonth(year: number, month: number) {
  return new Date(year, month, 1);
}

function datesInRange(startYmd: string, endYmd: string): string[] {
  const start = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  if (!start || !end) return [];
  const lo = start <= end ? start : end;
  const hi = start <= end ? end : start;
  const out: string[] = [];
  const cur = new Date(lo);
  while (cur <= hi) {
    out.push(toYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function ymdFromElement(el: Element | null): string | null {
  if (!el) return null;
  const btn = el.closest<HTMLElement>("[data-ymd]");
  return btn?.dataset.ymd ?? null;
}

export interface MultiDateCalendarPickerProps {
  value: string[];
  onChange: (dates: string[]) => void;
  minDate?: string;
  className?: string;
}

export function MultiDateCalendarPicker({
  value,
  onChange,
  minDate,
  className = "",
}: MultiDateCalendarPickerProps) {
  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const minYmd = minDate ?? todayYmd;

  const initialView = useMemo(() => {
    const first = value.map(parseYmd).find(Boolean) as Date | undefined;
    const base = first ?? parseYmd(minYmd) ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  }, []);

  const [viewYear, setViewYear] = useState(initialView.year);
  const [viewMonth, setViewMonth] = useState(initialView.month);
  const [isDragging, setIsDragging] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const anchorRef = useRef<string | null>(null);
  const lastHoverRef = useRef<string | null>(null);
  const snapshotRef = useRef<string[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const minYmdRef = useRef(minYmd);
  minYmdRef.current = minYmd;

  const selectedSet = useMemo(() => new Set(value), [value]);

  const monthLabel = useMemo(
    () =>
      new Date(viewYear, viewMonth, 1).toLocaleDateString("it-IT", {
        month: "long",
        year: "numeric",
      }),
    [viewYear, viewMonth],
  );

  const cells = useMemo(() => {
    const total = daysInMonth(viewYear, viewMonth);
    const firstWeekday = (startOfMonth(viewYear, viewMonth).getDay() + 6) % 7;
    const out: Array<{ day: number | null; key: string; ymd: string | null }> = [];
    for (let i = 0; i < firstWeekday; i++) {
      out.push({ day: null, key: `e-${i}`, ymd: null });
    }
    for (let d = 1; d <= total; d++) {
      const ymd = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
      out.push({ day: d, key: ymd, ymd });
    }
    return out;
  }, [viewYear, viewMonth]);

  const endDrag = useCallback(() => {
    if (draggingRef.current && !didDragRef.current && anchorRef.current) {
      const ymd = anchorRef.current;
      if (ymd >= minYmdRef.current) {
        const current = valueRef.current;
        const next = current.includes(ymd)
          ? current.filter((d) => d !== ymd)
          : [...current, ymd].sort();
        onChangeRef.current(next);
      }
    }
    draggingRef.current = false;
    anchorRef.current = null;
    lastHoverRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [endDrag]);

  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, ymd: string) {
    if (ymd < minYmd) return;
    e.preventDefault();
    draggingRef.current = true;
    didDragRef.current = false;
    anchorRef.current = ymd;
    lastHoverRef.current = ymd;
    snapshotRef.current = value;
    setIsDragging(true);
  }

  function handleGridPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !anchorRef.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const ymd = ymdFromElement(el);
    if (!ymd || ymd < minYmd || ymd === lastHoverRef.current) return;
    lastHoverRef.current = ymd;
    didDragRef.current = true;
    const range = datesInRange(anchorRef.current, ymd).filter((d) => d >= minYmd);
    onChange(Array.from(new Set([...snapshotRef.current, ...range])).sort());
  }


  return (
    <div className={`space-y-2 ${className}`}>
      <div className="rounded-xl border border-base-300 bg-base-200/30 p-2.5 sm:p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-square"
            aria-label="Mese precedente"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold capitalize text-center min-w-[10rem]">{monthLabel}</p>
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-square"
            aria-label="Mese successivo"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-base-content/55 mb-0.5">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        <div
          ref={gridRef}
          onPointerMove={handleGridPointerMove}
          className={`grid grid-cols-7 gap-1 touch-none ${isDragging ? "select-none" : ""}`}
        >
          {cells.map((cell) => {
            if (cell.day === null || !cell.ymd) {
              return <div key={cell.key} className="h-8" aria-hidden />;
            }
            const isSelected = selectedSet.has(cell.ymd);
            const isToday = cell.ymd === todayYmd;
            const isDisabled = cell.ymd < minYmd;

            return (
              <button
                key={cell.key}
                type="button"
                data-ymd={cell.ymd}
                disabled={isDisabled}
                onPointerDown={(e) => handlePointerDown(e, cell.ymd!)}
                aria-label={cell.ymd}
                aria-pressed={isSelected}
                className={[
                  "h-8 rounded-lg text-sm font-medium transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isDisabled
                    ? "text-base-content/25 cursor-not-allowed"
                    : isSelected
                      ? "bg-primary text-primary-content shadow-sm"
                      : isToday
                        ? "ring-2 ring-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                        : "hover:bg-base-200 text-base-content",
                  !isDisabled && isDragging ? "cursor-crosshair" : !isDisabled ? "cursor-pointer" : "",
                ].join(" ")}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-base-content/50 mt-3 hidden sm:block">
          Clicca per selezionare/deselezionare, trascina per un intervallo.
        </p>
      </div>

    </div>
  );
}
