import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Bold,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Underline,
} from "lucide-react";

type RichTextEditorProps = {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  /** Starting height in px (user can drag to resize). */
  initialHeight?: number;
};

function ToolbarButton({
  label,
  onMouseDown,
  children,
}: {
  label: string;
  onMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={onMouseDown}
      className="rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

function isHtmlEmpty(html: string): boolean {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

export function RichTextEditor({
  name,
  defaultValue = "",
  placeholder = "Scrivi il report…",
  initialHeight = 280,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const [html, setHtml] = useState(defaultValue);
  const [isEmpty, setIsEmpty] = useState(isHtmlEmpty(defaultValue));
  const editorId = useId();

  useEffect(() => {
    const el = editorRef.current;
    if (!el || seeded.current) return;
    el.innerHTML = defaultValue || "";
    seeded.current = true;
    setHtml(defaultValue || "");
    setIsEmpty(isHtmlEmpty(defaultValue));
  }, [defaultValue]);

  const sync = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = el.innerHTML;
    const empty = isHtmlEmpty(next);
    setHtml(empty ? "" : next);
    setIsEmpty(empty);
  }, []);

  const run = useCallback(
    (command: string, value?: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      sync();
    },
    [sync]
  );

  const addLink = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const url = window.prompt("URL del link:", "https://");
      if (!url) return;
      editorRef.current?.focus();
      document.execCommand("createLink", false, url);
      sync();
    },
    [sync]
  );

  return (
    <div className="rounded-md border border-slate-300 bg-white focus-within:border-[#3aaeba] focus-within:ring-1 focus-within:ring-[#3aaeba]">
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border-b border-slate-200 bg-slate-50 px-1.5 py-1">
        <ToolbarButton label="Grassetto" onMouseDown={run("bold")}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Corsivo" onMouseDown={run("italic")}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Sottolineato" onMouseDown={run("underline")}>
          <Underline className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        <ToolbarButton label="Titolo" onMouseDown={run("formatBlock", "h2")}>
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Elenco puntato" onMouseDown={run("insertUnorderedList")}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Elenco numerato" onMouseDown={run("insertOrderedList")}>
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Inserisci link" onMouseDown={addLink}>
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>
      </div>
      <div className="relative">
        {isEmpty && (
          <div
            className="pointer-events-none absolute left-2.5 top-2 z-10 text-sm text-slate-400"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
        <div
          id={editorId}
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Report incontro"
          contentEditable
          suppressContentEditableWarning
          onInput={sync}
          onBlur={sync}
          style={{ height: initialHeight }}
          className="min-h-[140px] max-h-[70vh] resize-y overflow-auto px-2.5 py-2 text-sm text-slate-900 outline-none [&_a]:text-[#3aaeba] [&_a]:underline [&_ul]:my-1 [&_ol]:my-1 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold"
        />
      </div>
      <input type="hidden" name={name} value={html} />
    </div>
  );
}
