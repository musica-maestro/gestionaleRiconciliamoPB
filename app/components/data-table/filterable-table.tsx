import { Form } from "@remix-run/react";

export interface FilterableTableProps {
  /** Form id (e.g. for external submit button) */
  id?: string;
  method?: "get" | "post";
  /** Hidden inputs to include (e.g. sort, order) */
  hiddenFields?: Record<string, string>;
  children: React.ReactNode;
  /** Optional footer rendered outside the scroll area (e.g. pagination) - stays fixed when scrolling horizontally */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Wraps a table in a Form and card for filterable/sortable data tables.
 * Use with FilterTextInput, FilterSelect, FilterDateRange in thead and SortLink for headers.
 * When footer is provided, it renders outside the scroll container so it stays fixed during horizontal scroll.
 */
export function FilterableTable({
  id,
  method = "get",
  hiddenFields = {},
  children,
  footer,
  className = "",
}: FilterableTableProps) {
  return (
    <Form
      method={method}
      id={id}
      className={`card bg-base-100 shadow-md overflow-hidden border-2 border-base-200 rounded-xl flex flex-col p-0 ${className}`}
    >
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className={`${footer ? "min-h-0 overflow-x-auto overflow-y-auto max-h-[calc(100vh-18rem)]" : "overflow-x-auto"}`}>
        {children}
      </div>
      {footer && <div className="shrink-0">{footer}</div>}
    </Form>
  );
}

export const filterableTableHeadClass =
  "bg-base-300/80 border-b-2 border-base-300";

export const filterableTableThClass =
  "px-3 py-3 align-top whitespace-nowrap";

export const filterableTableHeaderLabelClass =
  "mb-2 font-bold text-base-content";
