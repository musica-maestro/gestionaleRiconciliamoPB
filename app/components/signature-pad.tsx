import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Eraser, MousePointer2, PenLine, Upload } from "lucide-react";

type Mode = "draw" | "upload";

type SignaturePadProps = {
  dataFieldName?: string;
  fileFieldName?: string;
  existingUrl?: string | null;
  removeFieldName?: string;
  className?: string;
};

/**
 * Draw a signature with mouse/touch or upload an image file.
 * Drawn signatures are submitted as a PNG data URL in `dataFieldName`.
 */
export function SignaturePad({
  dataFieldName = "firma_data",
  fileFieldName = "firma",
  existingUrl = null,
  removeFieldName = "remove_firma",
  className = "",
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const stroked = useRef(false);
  const [mode, setMode] = useState<Mode>("draw");
  const [hasStroke, setHasStroke] = useState(false);
  const [dataUrl, setDataUrl] = useState("");
  const fileInputId = useId();

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = parent.clientWidth;
    const cssH = 160;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.25;
    ctx.clearRect(0, 0, cssW, cssH);
    stroked.current = false;
    setHasStroke(false);
    setDataUrl("");
  }, []);

  useEffect(() => {
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resizeCanvas]);

  const getPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const syncDataUrl = () => {
    const canvas = canvasRef.current;
    if (!canvas || !stroked.current) {
      setDataUrl("");
      return;
    }
    setDataUrl(canvas.toDataURL("image/png"));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = getPos(e);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !last.current) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    last.current = pos;
    if (!stroked.current) {
      stroked.current = true;
      setHasStroke(true);
    }
  };

  const endStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    syncDataUrl();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    stroked.current = false;
    setHasStroke(false);
    setDataUrl("");
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="inline-flex rounded-xl border border-base-300 bg-base-200/50 p-1 gap-0.5">
        <button
          type="button"
          onClick={() => setMode("draw")}
          className={
            mode === "draw"
              ? "inline-flex items-center gap-1.5 rounded-lg bg-base-100 px-3 py-1.5 text-xs font-medium shadow-sm text-base-content"
              : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-base-content/65 hover:text-base-content"
          }
        >
          <MousePointer2 className="h-3.5 w-3.5" />
          Disegna
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("upload");
            clear();
          }}
          className={
            mode === "upload"
              ? "inline-flex items-center gap-1.5 rounded-lg bg-base-100 px-3 py-1.5 text-xs font-medium shadow-sm text-base-content"
              : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-base-content/65 hover:text-base-content"
          }
        >
          <Upload className="h-3.5 w-3.5" />
          Carica file
        </button>
      </div>

      {mode === "draw" ? (
        <div className="space-y-2">
          <div className="relative rounded-xl border border-base-300 bg-white overflow-hidden touch-none">
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-300 select-none">
                Firma qui
              </span>
            </div>
            <canvas
              ref={canvasRef}
              className="block w-full cursor-crosshair touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={(e) => {
                if (drawing.current) endStroke(e);
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clear}
              className="btn btn-ghost btn-xs gap-1"
              disabled={!hasStroke}
            >
              <Eraser className="h-3.5 w-3.5" />
              Cancella
            </button>
            <span className="text-[11px] text-base-content/55">
              Usa mouse o dito. La firma viene salvata con «Salva modifiche».
            </span>
          </div>
          {dataUrl ? <input type="hidden" name={dataFieldName} value={dataUrl} /> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="label py-0" htmlFor={fileInputId}>
            <span className="label-text text-xs font-medium">
              {existingUrl ? "Sostituisci con file" : "File immagine"}
            </span>
          </label>
          <input
            id={fileInputId}
            name={fileFieldName}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="file-input file-input-bordered file-input-sm w-full max-w-md"
          />
          <p className="text-[11px] text-base-content/55">
            PNG con sfondo trasparente consigliato.
          </p>
        </div>
      )}

      {existingUrl && (
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <div className="rounded-lg border border-dashed border-base-300 bg-base-200/40 px-3 py-2 min-w-[140px] min-h-[56px] flex items-center justify-center">
            <img
              src={existingUrl}
              alt="Firma attuale"
              className="max-h-12 max-w-[180px] object-contain"
            />
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-error/90">
            <input
              type="checkbox"
              name={removeFieldName}
              value="1"
              className="checkbox checkbox-sm checkbox-error"
            />
            Rimuovi firma attuale
          </label>
        </div>
      )}

      {!existingUrl && mode === "upload" && (
        <div className="flex items-center gap-2 text-xs text-base-content/45">
          <PenLine className="h-3.5 w-3.5" />
          Nessuna firma salvata
        </div>
      )}
    </div>
  );
}
