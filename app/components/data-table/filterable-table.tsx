import { createContext, useContext } from "react";
import { Form } from "@remix-run/react";

export interface FilterableTableProps {
  /** Form id — filter inputs associate via the HTML `form` attribute */
  id?: string;
  method?: "get" | "post";
  /** Hidden inputs to include (e.g. sort, order) */
  hiddenFields?: Record<string, string>;
  children: React.ReactNode;
  /** Optional footer rendered outside the scroll area (e.g. pagination) - stays fixed when scrolling horizontally */
  footer?: React.ReactNode;
  className?: string;
}

const FilterFormIdContext = createContext<string | undefined>(undefined);

/** Form id for FilterableTable filter inputs (HTML `form` attribute). */
export function useFilterFormId(): string | undefined {
  return useContext(FilterFormIdContext);
}

/**
 * Card + scroll area for filterable tables.
 * The Remix Form holds only hidden fields; filter inputs live in `children` and
 * associate via `form={id}` so row/header checkboxes are NOT inside the Form
 * (avoids selection toggles interfering with GET filter submits).
 */
export function FilterableTable({
  id = "filterable-table-form",
  method = "get",
  hiddenFields = {},
  children,
  footer,
  className = "",
}: FilterableTableProps) {
  return (
    <div
      className={`card bg-base-100 shadow-md overflow-hidden border-2 border-base-200 rounded-xl flex flex-col p-0 ${className}`}
    >
      <Form method={method} id={id} className="hidden" aria-hidden="true">
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      </Form>
      <FilterFormIdContext.Provider value={id}>
        <div
          className={`${
            footer
              ? "min-h-0 overflow-x-auto overflow-y-auto max-h-[calc(100vh-18rem)]"
              : "overflow-x-auto"
          }`}
        >
          {children}
        </div>
      </FilterFormIdContext.Provider>
      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  );
}

export const filterableTableHeadClass =
  "bg-base-300/80 border-b-2 border-base-300";

export const filterableTableThClass =
  "px-3 py-3 align-top whitespace-nowrap";

export const filterableTableHeaderLabelClass =
  "mb-2 font-bold text-base-content";
