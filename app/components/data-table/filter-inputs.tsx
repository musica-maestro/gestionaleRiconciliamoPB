/**
 * Reusable filter inputs for data tables. Shared styling for text, select, and date range.
 * All filters auto-submit the form: text on Enter or after typing stops (debounced),
 * select and date on change.
 */

import { useRef, useCallback } from "react";

const DEBOUNCE_MS = 400;

const inputClass =
  "input input-bordered input-sm w-full max-w-full bg-base-100 text-base-content placeholder:opacity-70 " +
  "border-2 border-base-300 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

const selectClass =
  "select select-bordered select-sm w-full max-w-full bg-base-100 text-base-content " +
  "border-2 border-base-300 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

const dateInputClass =
  "input input-bordered input-sm w-full min-w-0 bg-base-100 text-base-content " +
  "border-2 border-base-300 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

const dateRangeInputClass =
  "input input-bordered input-xs w-full min-w-0 bg-base-100 text-base-content text-right " +
  "border-2 border-base-300 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

export interface FilterTextInputProps {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: "text" | "search";
  className?: string;
}

function submitFormFromInput(input: HTMLInputElement | HTMLSelectElement) {
  input.form?.requestSubmit();
}

export function FilterTextInput({
  name,
  defaultValue = "",
  placeholder,
  type = "text",
  className = "",
}: FilterTextInputProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitFormFromInput(e.currentTarget);
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      submitFormFromInput(e.target);
    }, DEBOUNCE_MS);
  }, []);

  return (
    <input
      name={name}
      type={type}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className={`${inputClass} ${className}`}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
    />
  );
}

export interface FilterSelectOption {
  value: string;
  label: string;
}

export interface FilterSelectProps {
  name: string;
  defaultValue?: string;
  options: FilterSelectOption[];
  /** Label for the empty option (e.g. "Tutte", "Tutti") */
  emptyLabel?: string;
  className?: string;
}

export function FilterSelect({
  name,
  defaultValue = "",
  options,
  emptyLabel = "Tutti",
  className = "",
}: FilterSelectProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    submitFormFromInput(e.target);
  }, []);

  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={`${selectClass} ${className}`}
      onChange={handleChange}
    >
      <option value="">{emptyLabel}</option>
      {options.filter((o) => o.value).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export interface FilterDateRangeProps {
  nameFrom: string;
  nameTo: string;
  valueFrom?: string;
  valueTo?: string;
  labelFrom?: string;
  labelTo?: string;
  className?: string;
}

export function FilterDateRange({
  nameFrom,
  nameTo,
  valueFrom = "",
  valueTo = "",
  labelFrom = "Da",
  labelTo = "A",
  className = "",
}: FilterDateRangeProps) {
  const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    submitFormFromInput(e.target);
  }, []);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label className="form-control w-full min-w-0">
        <span className="label py-0.5">
          <span className="label-text text-sm text-base-content/90">{labelFrom}</span>
        </span>
        <input
          name={nameFrom}
          type="date"
          defaultValue={valueFrom}
          className={dateRangeInputClass}
          aria-label={labelFrom}
          onChange={handleDateChange}
        />
      </label>
      <label className="form-control w-full min-w-0">
        <span className="label py-0.5">
          <span className="label-text text-sm text-base-content/90">{labelTo}</span>
        </span>
        <input
          name={nameTo}
          type="date"
          defaultValue={valueTo}
          className={dateRangeInputClass}
          aria-label={labelTo}
          onChange={handleDateChange}
        />
      </label>
    </div>
  );
}
