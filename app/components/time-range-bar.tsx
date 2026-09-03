import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

const START_HOUR = 8;
const END_HOUR = 20;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;
const SNAP_MINUTES = 15;

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function snap(min: number): number {
  return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES;
}

function clampMin(min: number): number {
  return Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, min));
}

function minuteToPercent(min: number): number {
  return ((min - START_HOUR * 60) / TOTAL_MINUTES) * 100;
}

function percentToMinute(pct: number): number {
  return snap(clampMin(START_HOUR * 60 + (pct / 100) * TOTAL_MINUTES));
}

export interface TimeRange {
  id: string;
  from: string;
  to: string;
}

export interface TimeRangeBarProps {
  ranges: TimeRange[];
  onChange: (ranges: TimeRange[]) => void;
  className?: string;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function TimeRangeBar({ ranges, onChange, className = "" }: TimeRangeBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    type: "create" | "move" | "resize-start" | "resize-end";
    rangeId?: string;
    startPct: number;
    startMin: number;
    origFrom?: number;
    origTo?: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const pctFromEvent = useCallback((clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-handle]")) return;
      if (target.closest("[data-range]")) return;

      const pct = pctFromEvent(e.clientX);
      const min = percentToMinute(pct);
      const id = newId();
      draggingRef.current = { type: "create", rangeId: id, startPct: pct, startMin: min };
      onChange([...ranges, { id, from: minutesToTime(min), to: minutesToTime(min) }]);
      setIsDragging(true);
      e.preventDefault();
    },
    [ranges, onChange, pctFromEvent],
  );

  const handleRangePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, rangeId: string) => {
      e.stopPropagation();
      e.preventDefault();
      const r = ranges.find((r) => r.id === rangeId);
      if (!r) return;
      const pct = pctFromEvent(e.clientX);
      draggingRef.current = {
        type: "move",
        rangeId,
        startPct: pct,
        startMin: 0,
        origFrom: timeToMinutes(r.from),
        origTo: timeToMinutes(r.to),
      };
      setIsDragging(true);
    },
    [ranges, pctFromEvent],
  );

  const handleHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, rangeId: string, edge: "start" | "end") => {
      e.stopPropagation();
      e.preventDefault();
      const r = ranges.find((r) => r.id === rangeId);
      if (!r) return;
      draggingRef.current = {
        type: edge === "start" ? "resize-start" : "resize-end",
        rangeId,
        startPct: pctFromEvent(e.clientX),
        startMin: 0,
        origFrom: timeToMinutes(r.from),
        origTo: timeToMinutes(r.to),
      };
      setIsDragging(true);
    },
    [ranges, pctFromEvent],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = draggingRef.current;
      if (!d) return;
      const pct = pctFromEvent(e.clientX);
      const min = percentToMinute(pct);

      if (d.type === "create") {
        const lo = Math.min(d.startMin, min);
        const hi = Math.max(d.startMin, min);
        onChange(
          ranges.map((r) =>
            r.id === d.rangeId ? { ...r, from: minutesToTime(lo), to: minutesToTime(hi) } : r,
          ),
        );
      } else if (d.type === "move" && d.origFrom != null && d.origTo != null) {
        const deltaPct = pct - d.startPct;
        const deltaMin = snap((deltaPct / 100) * TOTAL_MINUTES);
        let newFrom = clampMin(d.origFrom + deltaMin);
        let newTo = clampMin(d.origTo + deltaMin);
        const dur = d.origTo - d.origFrom;
        if (newFrom < START_HOUR * 60) { newFrom = START_HOUR * 60; newTo = newFrom + dur; }
        if (newTo > END_HOUR * 60) { newTo = END_HOUR * 60; newFrom = newTo - dur; }
        onChange(
          ranges.map((r) =>
            r.id === d.rangeId ? { ...r, from: minutesToTime(snap(newFrom)), to: minutesToTime(snap(newTo)) } : r,
          ),
        );
      } else if (d.type === "resize-start" && d.origTo != null) {
        const newFrom = Math.min(min, d.origTo - SNAP_MINUTES);
        onChange(
          ranges.map((r) =>
            r.id === d.rangeId ? { ...r, from: minutesToTime(Math.max(START_HOUR * 60, newFrom)) } : r,
          ),
        );
      } else if (d.type === "resize-end" && d.origFrom != null) {
        const newTo = Math.max(min, d.origFrom + SNAP_MINUTES);
        onChange(
          ranges.map((r) =>
            r.id === d.rangeId ? { ...r, to: minutesToTime(Math.min(END_HOUR * 60, newTo)) } : r,
          ),
        );
      }
    }

    function onUp() {
      if (draggingRef.current) {
        const d = draggingRef.current;
        if (d.type === "create") {
          const r = ranges.find((r) => r.id === d.rangeId);
          if (r && r.from === r.to) {
            onChange(ranges.filter((r) => r.id !== d.rangeId));
          }
        }
      }
      draggingRef.current = null;
      setIsDragging(false);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [ranges, onChange, pctFromEvent]);

  function removeRange(id: string) {
    onChange(ranges.filter((r) => r.id !== id));
  }

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) out.push(h);
    return out;
  }, []);

  const validRanges = ranges.filter((r) => timeToMinutes(r.from) < timeToMinutes(r.to));

  return (
    <div className={`space-y-2 ${className}`}>
      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        className={`relative h-12 rounded-lg bg-base-200 border border-base-300 touch-none ${
          isDragging ? "select-none cursor-col-resize" : "cursor-crosshair"
        }`}
      >
        {/* Hour ticks */}
        {hours.map((h) => {
          const pct = minuteToPercent(h * 60);
          return (
            <div key={h} className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${pct}%` }}>
              <div className="w-px h-2 bg-base-content/20" />
              <span className="text-[9px] text-base-content/40 mt-px leading-none select-none">
                {h}
              </span>
            </div>
          );
        })}

        {/* Ranges */}
        {validRanges.map((r) => {
          const fromMin = timeToMinutes(r.from);
          const toMin = timeToMinutes(r.to);
          const left = minuteToPercent(fromMin);
          const width = minuteToPercent(toMin) - left;

          return (
            <div
              key={r.id}
              data-range="true"
              className="absolute top-1 bottom-1 rounded-md bg-primary/80 hover:bg-primary transition-colors cursor-grab active:cursor-grabbing group"
              style={{ left: `${left}%`, width: `${width}%`, minWidth: "4px" }}
              onPointerDown={(e) => handleRangePointerDown(e, r.id)}
            >
              {width > 8 && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-primary-content pointer-events-none select-none truncate px-1">
                  {r.from}–{r.to}
                </span>
              )}
              <div
                data-handle="true"
                className="absolute left-0 top-0 bottom-0 w-2 cursor-w-resize rounded-l-md hover:bg-primary-content/20"
                onPointerDown={(e) => handleHandlePointerDown(e, r.id, "start")}
              />
              <div
                data-handle="true"
                className="absolute right-0 top-0 bottom-0 w-2 cursor-e-resize rounded-r-md hover:bg-primary-content/20"
                onPointerDown={(e) => handleHandlePointerDown(e, r.id, "end")}
              />
            </div>
          );
        })}
      </div>

      {/* Chips */}
      {validRanges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {validRanges.map((r) => (
            <span key={r.id} className="badge badge-sm badge-outline gap-1 pl-2 pr-0.5 font-normal tabular-nums">
              {r.from}–{r.to}
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square min-h-0 h-5 w-5"
                aria-label={`Rimuovi ${r.from}–${r.to}`}
                onClick={() => removeRange(r.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="text-xs text-base-content/50">
        Trascina sulla barra per creare fasce. Trascina i bordi per ridimensionare, il centro per spostare.
      </p>
    </div>
  );
}
