import { Link, useLocation } from "@remix-run/react";

export interface SortLinkProps {
  label: string;
  field: string;
  currentSort: string;
  currentOrder: string;
  searchParams: URLSearchParams;
  /** Optional base path (defaults to current pathname) */
  basePath?: string;
  /** Optional query param names (defaults to "sort" and "order") */
  sortParam?: string;
  orderParam?: string;
}

export function SortLink({
  label,
  field,
  currentSort,
  currentOrder,
  searchParams,
  basePath,
  sortParam = "sort",
  orderParam = "order",
}: SortLinkProps) {
  const location = useLocation();
  const pathname = basePath ?? location.pathname;
  const nextOrder = currentSort === field && currentOrder === "asc" ? "desc" : "asc";
  const params = new URLSearchParams(searchParams);
  params.set(sortParam, field);
  params.set(orderParam, nextOrder);
  const isActive = currentSort === field;

  return (
    <Link
      to={`${pathname}?${params.toString()}`}
      className={`link link-hover font-bold ${isActive ? "underline" : ""}`}
    >
      {label}
      {isActive && (currentOrder === "asc" ? " ↑" : " ↓")}
    </Link>
  );
}
