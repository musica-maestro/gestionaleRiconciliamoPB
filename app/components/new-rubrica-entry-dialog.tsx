import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "@remix-run/react";
import { X } from "lucide-react";

export type RubricaEntryType = "soggetto_fisica" | "soggetto_giuridica" | "avvocato";

const ENTRY_TYPE_OPTIONS: { value: RubricaEntryType; label: string }[] = [
  { value: "soggetto_fisica", label: "Persona fisica" },
  { value: "soggetto_giuridica", label: "Persona giuridica" },
  { value: "avvocato", label: "Avvocato" },
];

const formFieldClass =
  "input input-bordered input-sm w-full bg-base-100 text-base-content border-2 border-base-300 focus:border-primary focus:outline-none";
const labelClass = "label py-0.5";
const labelTextClass = "label-text text-sm font-medium text-base-content";

function Field({
  name,
  label,
  type = "text",
  placeholder,
  required,
  maxLength,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  defaultValue?: string;
}) {
  return (
    <label className="form-control w-full">
      <div className={labelClass}>
        <span className={labelTextClass}>
          {label}
          {required && <span className="text-error"> *</span>}
        </span>
      </div>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        className={formFieldClass}
      />
    </label>
  );
}

export interface NewRubricaEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Preselect type when opening (e.g. from "Nuovo soggetto" vs "Nuovo avvocato") */
  initialType?: RubricaEntryType | null;
}

export function NewRubricaEntryDialog({
  isOpen,
  onClose,
  initialType = null,
}: NewRubricaEntryDialogProps) {
  const [entryType, setEntryType] = useState<RubricaEntryType>("soggetto_fisica");
  const fetcher = useFetcher<{ error?: string }>();

  useEffect(() => {
    if (isOpen && initialType) {
      setEntryType(initialType);
    } else if (isOpen) {
      setEntryType("soggetto_fisica");
    }
  }, [isOpen, initialType]);

  const isSoggetto = entryType === "soggetto_fisica" || entryType === "soggetto_giuridica";
  const isFisica = entryType === "soggetto_fisica";
  const isGiuridica = entryType === "soggetto_giuridica";
  const isAvvocato = entryType === "avvocato";
  const isSubmitting = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  if (!isOpen) return null;

  const dialogContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-rubrica-dialog-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-6 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-base-100 shadow-xl flex flex-col max-h-[90vh] overflow-hidden border-2 border-base-200 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-base-200 px-4 py-3 shrink-0">
          <h2 id="new-rubrica-dialog-title" className="text-base font-semibold text-base-content">
            Nuova voce in rubrica
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <fetcher.Form method="post" action="/rubrica/create" className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <input type="hidden" name="_entryType" value={entryType} />

          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            <div>
              <div className={labelClass}>
                <span className={labelTextClass}>Tipo</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ENTRY_TYPE_OPTIONS.map(({ value, label }) => (
                  <label key={value} className="label cursor-pointer gap-2 bg-base-200/60 rounded-lg px-3 py-2 border-2 border-transparent has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                    <input
                      type="radio"
                      name="entryTypeRadio"
                      value={value}
                      checked={entryType === value}
                      onChange={() => setEntryType(value)}
                      className="radio radio-primary radio-sm"
                    />
                    <span className="label-text">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Nome e Cognome (solo persona fisica e avvocato) */}
            {!isGiuridica && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field name="nome" label="Nome" />
                <Field name="cognome" label="Cognome" />
              </div>
            )}

            {isSoggetto && (
              <>
                {isFisica && <Field name="codice_fiscale" label="Codice fiscale" />}
                {isGiuridica && (
                  <>
                    <Field name="ragione_sociale" label="Ragione sociale" />
                    <Field name="piva" label="P.IVA" />
                  </>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field name="email" label="Email" type="email" />
                  <Field name="pec" label="PEC" type="email" />
                </div>
                <Field name="indirizzo_riga_1" label="Indirizzo" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field name="numero_civico" label="N. civico" placeholder="N. civico" />
                  <Field name="indirizzo_riga_2" label="Indirizzo (riga 2)" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field name="comune" label="Comune" />
                  <Field name="provincia" label="Provincia" maxLength={2} />
                  <Field name="cap" label="CAP" />
                </div>
                <Field name="paese" label="Paese" defaultValue="Italia" />
              </>
            )}

            {isAvvocato && (
              <>
                <Field name="pec" label="PEC" type="email" />
                <Field name="telefono" label="Telefono" type="tel" />
                <Field name="foro_di_appartenenza" label="Foro di appartenenza" />
                <Field name="numero_tessera_foro" label="N. tessera foro" />
              </>
            )}

            {error && (
              <div className="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 p-4 border-t-2 border-base-200 shrink-0">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Annulla
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={isSubmitting}>
              {isSubmitting ? "Creazione…" : "Crea"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );

  return createPortal(dialogContent, document.body);
}
