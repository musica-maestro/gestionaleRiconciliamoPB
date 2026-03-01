/**
 * Shared structure and components for AddParteDialog and AddAvvocatoDialog.
 * Single place to change layout, styling, and common UI patterns.
 */
import { Search, X } from "lucide-react";

// ─── Shared form styling ─────────────────────────────────────────────────────
export const INPUT =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#3aaeba] focus:border-[#3aaeba]";
export const LABEL = "block text-xs font-medium text-slate-600 mb-1";

// ─── Detail row for selected item cards ───────────────────────────────────────
export function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-[11px] text-slate-500 shrink-0">{label}</span>
      <span className="text-[11px] font-medium text-slate-700 truncate">{value}</span>
    </div>
  );
}

// ─── Selection indicator (radio for single, checkbox for multi) ───────────────
export function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      className={`w-4 h-4 shrink-0 flex items-center justify-center border rounded-full transition-colors ${
        selected ? "bg-[#3aaeba] border-[#3aaeba]" : "border-slate-300 bg-white"
      }`}
    >
      {selected && (
        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
          <path
            d="M1.5 5L4 7.5L8.5 2.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

export function CheckboxIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      className={`mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center border rounded transition-colors ${
        selected ? "bg-[#3aaeba] border-[#3aaeba]" : "border-slate-300 bg-white"
      }`}
    >
      {selected && (
        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
          <path
            d="M1.5 5L4 7.5L8.5 2.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

// ─── Search input with icon ───────────────────────────────────────────────────
interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}

export function SearchInput({ value, onChange, placeholder, autoFocus }: SearchInputProps) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#3aaeba]"
        autoFocus={autoFocus}
      />
    </div>
  );
}

// ─── Split-panel dialog shell ────────────────────────────────────────────────

export interface SplitPanelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
}

export function SplitPanelDialog({
  isOpen,
  onClose,
  title,
  subtitle,
  leftPanel,
  rightPanel,
}: SplitPanelDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-5xl bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ height: "min(84vh, 720px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: left 42% / right 58% */}
        <div className="flex flex-1 min-h-0">
          <div className="w-[42%] border-r border-slate-200 flex flex-col min-h-0">
            {leftPanel}
          </div>
          <div className="w-[58%] flex flex-col min-h-0">
            {rightPanel}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Left panel sections ─────────────────────────────────────────────────────

export interface LeftPanelSectionProps {
  sectionTitle: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  listContent: React.ReactNode;
  footerContent: React.ReactNode;
}

export function LeftPanelSection({
  sectionTitle,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  listContent,
  footerContent,
}: LeftPanelSectionProps) {
  return (
    <>
      <div className="px-3 pt-3 pb-2.5 border-b border-slate-100 shrink-0">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          {sectionTitle}
        </p>
        <SearchInput
          value={searchValue}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          autoFocus
        />
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">{listContent}</ul>
      <div className="shrink-0 border-t border-slate-200 p-3 space-y-2.5 bg-slate-50/60">
        {footerContent}
      </div>
    </>
  );
}

// ─── Right panel sections ─────────────────────────────────────────────────────

export interface RightPanelSectionProps {
  headerContent: React.ReactNode;
  formContent: React.ReactNode;
  footerContent: React.ReactNode;
}

export function RightPanelSection({
  headerContent,
  formContent,
  footerContent,
}: RightPanelSectionProps) {
  return (
    <>
      <div className="flex items-end border-b border-slate-200 px-4 pt-3 shrink-0 gap-1">
        {headerContent}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">{formContent}</div>
      <div className="shrink-0 border-t border-slate-200 px-5 py-3 flex gap-2.5 bg-slate-50/60">
        {footerContent}
      </div>
    </>
  );
}

// ─── List item button (shared selectable row) ─────────────────────────────────

interface ListItemButtonProps {
  isSelected: boolean;
  onToggle: () => void;
  indicator: React.ReactNode;
  children: React.ReactNode;
}

export function ListItemButton({ isSelected, onToggle, indicator, children }: ListItemButtonProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${
          isSelected ? "bg-[#3aaeba]/5" : ""
        }`}
      >
        {indicator}
        <div className="min-w-0 flex-1">{children}</div>
      </button>
    </li>
  );
}
