import { useState, useMemo, useEffect } from "react";
import { Form } from "@remix-run/react";
import { User, Building2 } from "lucide-react";
import {
  SplitPanelDialog,
  LeftPanelSection,
  RightPanelSection,
  DetailRow,
  ListItemButton,
  SelectionIndicator,
  INPUT,
  LABEL,
} from "~/components/rubrica-dialog-shared";

export interface SoggettoItem {
  id: string;
  display: string;
  secondary?: string;
  codice_fiscale?: string;
  email?: string;
  pec?: string;
  piva?: string;
  comune?: string;
  provincia?: string;
  indirizzo?: string;
}

interface AddParteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  soggetti: SoggettoItem[];
}

const FIELD_CREATE_FORM = "create-soggetto-form";

// ─── Persona Fisica fields ────────────────────────────────────────────────────

function PersonaFisicaFields() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Nome <span className="text-red-500">*</span></label>
          <input name="nome" required autoComplete="given-name" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Cognome <span className="text-red-500">*</span></label>
          <input name="cognome" required autoComplete="family-name" className={INPUT} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Codice fiscale</label>
          <input name="codice_fiscale" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Email</label>
          <input name="email" type="email" autoComplete="email" className={INPUT} />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <div>
          <label className={LABEL}>Indirizzo</label>
          <input name="indirizzo_riga_1" placeholder="Via / Piazza…" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>N. civico</label>
          <input name="numero_civico" className={INPUT} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Indirizzo riga 2</label>
        <input name="indirizzo_riga_2" placeholder="Scala, interno…" className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Comune</label>
          <input name="comune" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Provincia</label>
          <input name="provincia" maxLength={2} placeholder="RM" className={INPUT} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>CAP</label>
          <input name="cap" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Paese</label>
          <input name="paese" defaultValue="Italia" className={INPUT} />
        </div>
      </div>
    </div>
  );
}

// ─── Persona Giuridica fields ─────────────────────────────────────────────────

function PersonaGiuridicaFields() {
  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Ragione sociale <span className="text-red-500">*</span></label>
        <input name="ragione_sociale" required className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>P.IVA</label>
          <input name="piva" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Codice fiscale</label>
          <input name="codice_fiscale" className={INPUT} />
        </div>
      </div>
      <div>
        <label className={LABEL}>PEC</label>
        <input name="pec" type="email" className={INPUT} />
      </div>
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <div>
          <label className={LABEL}>Sede legale</label>
          <input name="indirizzo_riga_1" placeholder="Via / Piazza…" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>N. civico</label>
          <input name="numero_civico" className={INPUT} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Indirizzo riga 2</label>
        <input name="indirizzo_riga_2" placeholder="Piano, scala…" className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Comune</label>
          <input name="comune" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Provincia</label>
          <input name="provincia" maxLength={2} placeholder="RM" className={INPUT} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>CAP</label>
          <input name="cap" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Paese</label>
          <input name="paese" defaultValue="Italia" className={INPUT} />
        </div>
      </div>
    </div>
  );
}

// ─── Selected soggetto detail card ───────────────────────────────────────────

function SelectedSoggettoCard({ soggetto }: { soggetto: SoggettoItem }) {
  const isGiuridica = soggetto.secondary === "Giuridica";
  const luogo = [soggetto.comune, soggetto.provincia ? `(${soggetto.provincia})` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rounded-lg border border-[#3aaeba]/25 bg-[#3aaeba]/5 px-3 py-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 leading-snug">{soggetto.display}</p>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            isGiuridica ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"
          }`}
        >
          {isGiuridica ? "Giuridica" : "Fisica"}
        </span>
      </div>
      <div className="space-y-0.5 pt-0.5 border-t border-[#3aaeba]/15">
        {isGiuridica ? (
          <>
            <DetailRow label="P.IVA" value={soggetto.piva} />
            <DetailRow label="CF" value={soggetto.codice_fiscale} />
            <DetailRow label="PEC" value={soggetto.pec} />
            <DetailRow label="Sede" value={soggetto.indirizzo} />
            <DetailRow label="Comune" value={luogo || undefined} />
          </>
        ) : (
          <>
            <DetailRow label="CF" value={soggetto.codice_fiscale} />
            <DetailRow label="Email" value={soggetto.email} />
            <DetailRow label="Indirizzo" value={soggetto.indirizzo} />
            <DetailRow label="Comune" value={luogo || undefined} />
          </>
        )}
        {!soggetto.codice_fiscale &&
          !soggetto.email &&
          !soggetto.pec &&
          !soggetto.piva &&
          !soggetto.comune &&
          !soggetto.indirizzo && (
            <p className="text-[11px] text-slate-400 italic">Nessun dettaglio disponibile</p>
          )}
      </div>
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function AddParteDialog({ isOpen, onClose, soggetti }: AddParteDialogProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createTab, setCreateTab] = useState<"fisica" | "giuridica">("fisica");
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedId(null);
      setCreateTab("fisica");
      setFormKey((k) => k + 1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return soggetti;
    const q = search.toLowerCase();
    return soggetti.filter(
      (s) =>
        s.display.toLowerCase().includes(q) || s.secondary?.toLowerCase().includes(q)
    );
  }, [soggetti, search]);

  const selected = selectedId ? soggetti.find((s) => s.id === selectedId) : null;

  const leftPanel = (
    <LeftPanelSection
      sectionTitle="Soggetti esistenti"
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="Cerca per nome, tipo…"
      listContent={
        <>
          {filtered.length === 0 && (
            <li className="p-5 text-center text-sm text-slate-400">Nessun risultato</li>
          )}
          {filtered.map((s) => {
            const isSel = s.id === selectedId;
            const isGiuridica = s.secondary === "Giuridica";
            return (
              <ListItemButton
                key={s.id}
                isSelected={isSel}
                onToggle={() => setSelectedId(isSel ? null : s.id)}
                indicator={<SelectionIndicator selected={isSel} />}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`flex-1 text-sm font-medium truncate ${isSel ? "text-[#3aaeba]" : "text-slate-800"}`}>
                    {s.display}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      isGiuridica ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    {isGiuridica ? "G" : "F"}
                  </span>
                </div>
              </ListItemButton>
            );
          })}
        </>
      }
      footerContent={
        <>
          {selected ? (
            <SelectedSoggettoCard soggetto={selected} />
          ) : (
            <p className="text-xs text-slate-400 text-center py-0.5">
              Seleziona un soggetto per aggiungerlo
            </p>
          )}
          <Form method="post" onSubmit={onClose} className="flex gap-2">
            <input type="hidden" name="_action" value="add_partecipazione" />
            <input type="hidden" name="soggetto_id" value={selectedId ?? ""} />
            <button
              type="submit"
              name="istante_o_chiamato"
              value="Istante"
              disabled={!selectedId}
              className="flex-1 rounded-lg bg-sky-500 px-2 py-2 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            >
              + Istante
            </button>
            <button
              type="submit"
              name="istante_o_chiamato"
              value="Chiamato"
              disabled={!selectedId}
              className="flex-1 rounded-lg bg-violet-500 px-2 py-2 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            >
              + Chiamato
            </button>
          </Form>
        </>
      }
    />
  );

  const rightPanel = (
    <RightPanelSection
      headerContent={
        <>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pb-2 mr-3">
            Crea nuovo
          </p>
          <button
            type="button"
            onClick={() => setCreateTab("fisica")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              createTab === "fisica"
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            <User className="h-3.5 w-3.5" />
            Persona Fisica
          </button>
          <button
            type="button"
            onClick={() => setCreateTab("giuridica")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              createTab === "giuridica"
                ? "border-violet-500 text-violet-600"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            Persona Giuridica
          </button>
        </>
      }
      formContent={
        <Form key={formKey} id={FIELD_CREATE_FORM} method="post" onSubmit={onClose}>
          <input type="hidden" name="_action" value="create_soggetto_and_partecipazione" />
          <input type="hidden" name="tipo" value={createTab === "fisica" ? "Fisica" : "Giuridica"} />
          {createTab === "fisica" ? <PersonaFisicaFields /> : <PersonaGiuridicaFields />}
        </Form>
      }
      footerContent={
        <>
          <button
            type="submit"
            form={FIELD_CREATE_FORM}
            name="istante_o_chiamato"
            value="Istante"
            className="flex-1 rounded-lg bg-sky-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
          >
            Crea e aggiungi come Istante
          </button>
          <button
            type="submit"
            form={FIELD_CREATE_FORM}
            name="istante_o_chiamato"
            value="Chiamato"
            className="flex-1 rounded-lg bg-violet-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-600 transition-colors"
          >
            Crea e aggiungi come Chiamato
          </button>
        </>
      }
    />
  );

  return (
    <SplitPanelDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Aggiungi parte"
      leftPanel={leftPanel}
      rightPanel={rightPanel}
    />
  );
}
