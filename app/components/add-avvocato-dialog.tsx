import { useState, useMemo, useEffect } from "react";
import { Form } from "@remix-run/react";
import { Briefcase, X } from "lucide-react";
import {
  SplitPanelDialog,
  LeftPanelSection,
  RightPanelSection,
  DetailRow,
  ListItemButton,
  CheckboxIndicator,
  INPUT,
  LABEL,
} from "~/components/rubrica-dialog-shared";

export interface AvvocatoItem {
  id: string;
  display: string;
  secondary?: string;
  pec?: string;
  telefono?: string;
  foro?: string;
  tessera?: string;
}

export interface ParteRef {
  id: string;
  soggetto_name: string;
  soggetto_id: string;
  istante_o_chiamato: string;
  avvocati_ids: string[];
}

interface AddAvvocatoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  parte: ParteRef | null;
  avvocati: AvvocatoItem[];
}

const CREATE_FORM_ID = "create-avvocato-form";

// ─── Selected avvocato detail card ───────────────────────────────────────────

function SelectedAvvocatoCard({
  avvocato,
  onRemove,
}: {
  avvocato: AvvocatoItem;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#3aaeba]/25 bg-[#3aaeba]/5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 leading-snug">{avvocato.display}</p>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Rimuovi"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1 space-y-0.5 pt-1 border-t border-[#3aaeba]/15">
        <DetailRow label="PEC" value={avvocato.pec} />
        <DetailRow label="Foro" value={avvocato.foro} />
        <DetailRow label="N° tessera" value={avvocato.tessera} />
        <DetailRow label="Tel." value={avvocato.telefono} />
        {!avvocato.pec && !avvocato.foro && !avvocato.tessera && !avvocato.telefono && (
          <p className="text-[11px] text-slate-400 italic">Nessun dettaglio disponibile</p>
        )}
      </div>
    </div>
  );
}

// ─── Create avvocato form ─────────────────────────────────────────────────────

function CreaAvvocatoFields() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Nome <span className="text-red-500">*</span></label>
          <input name="avv_nome" required autoComplete="given-name" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Cognome <span className="text-red-500">*</span></label>
          <input name="avv_cognome" required autoComplete="family-name" className={INPUT} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>PEC</label>
          <input name="avv_pec" type="email" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Telefono</label>
          <input name="avv_telefono" type="tel" className={INPUT} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Foro di appartenenza</label>
        <input name="avv_foro" className={INPUT} />
      </div>
      <div>
        <label className={LABEL}>N. tessera foro</label>
        <input name="avv_tessera" className={INPUT} />
      </div>
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function AddAvvocatoDialog({ isOpen, onClose, parte, avvocati }: AddAvvocatoDialogProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (isOpen && parte) {
      setSearch("");
      setSelectedIds(parte.avvocati_ids);
      setFormKey((k) => k + 1);
    }
  }, [isOpen, parte]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return avvocati;
    const q = search.toLowerCase();
    return avvocati.filter(
      (a) =>
        a.display.toLowerCase().includes(q) ||
        a.pec?.toLowerCase().includes(q) ||
        a.foro?.toLowerCase().includes(q)
    );
  }, [avvocati, search]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (!isOpen || !parte) return null;

  const leftPanel = (
    <LeftPanelSection
      sectionTitle="Avvocati esistenti"
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="Cerca per nome, PEC, foro…"
      listContent={
        <>
          {filtered.length === 0 && (
            <li className="p-5 text-center text-sm text-slate-400">Nessun risultato</li>
          )}
          {filtered.map((a) => {
            const isSelected = selectedIds.includes(a.id);
            return (
              <ListItemButton
                key={a.id}
                isSelected={isSelected}
                onToggle={() => toggleSelect(a.id)}
                indicator={<CheckboxIndicator selected={isSelected} />}
              >
                <div>
                  <div className={`text-sm font-medium truncate ${isSelected ? "text-[#3aaeba]" : "text-slate-800"}`}>
                    {a.display}
                  </div>
                  {(a.pec || a.foro) && (
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {[a.foro, a.pec].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </ListItemButton>
            );
          })}
        </>
      }
      footerContent={
        <>
          {selectedIds.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-0.5">
              Seleziona un avvocato per associarlo
            </p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {selectedIds.map((id) => {
                const a = avvocati.find((av) => av.id === id);
                return a ? (
                  <SelectedAvvocatoCard
                    key={id}
                    avvocato={a}
                    onRemove={() => setSelectedIds((prev) => prev.filter((x) => x !== id))}
                  />
                ) : null;
              })}
            </div>
          )}
          <Form method="post" onSubmit={onClose}>
            <input type="hidden" name="_action" value="update_partecipazione" />
            <input type="hidden" name="partecipazione_id" value={parte.id} />
            <input type="hidden" name="soggetto_id" value={parte.soggetto_id} />
            <input type="hidden" name="istante_o_chiamato" value={parte.istante_o_chiamato} />
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="avvocati[]" value={id} />
            ))}
            <button
              type="submit"
              className="w-full rounded-lg bg-[#3aaeba] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#349aa5] transition-colors"
            >
              Salva avvocati
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
          <div className="flex items-center gap-1.5 pb-2">
            <Briefcase className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-sm font-medium text-slate-600">Avvocato</span>
          </div>
        </>
      }
      formContent={
        <Form key={formKey} id={CREATE_FORM_ID} method="post" onSubmit={onClose}>
          <input type="hidden" name="_action" value="create_avvocato_and_update_partecipazione" />
          <input type="hidden" name="partecipazione_id" value={parte.id} />
          <input type="hidden" name="soggetto_id" value={parte.soggetto_id} />
          <input type="hidden" name="istante_o_chiamato" value={parte.istante_o_chiamato} />
          {selectedIds.map((id) => (
            <input key={id} type="hidden" name="avvocati[]" value={id} />
          ))}
          <CreaAvvocatoFields />
        </Form>
      }
      footerContent={
        <button
          type="submit"
          form={CREATE_FORM_ID}
          className="w-full rounded-lg bg-slate-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
        >
          Crea e associa alla parte
        </button>
      }
    />
  );

  return (
    <SplitPanelDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Gestisci avvocati"
      subtitle={parte.soggetto_name}
      leftPanel={leftPanel}
      rightPanel={rightPanel}
    />
  );
}
