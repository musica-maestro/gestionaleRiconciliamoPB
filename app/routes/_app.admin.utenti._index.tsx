import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUserAndRole } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";
import {
  FilterableTable,
  FilterTextInput,
  FilterSelect,
  SortLink,
  filterableTableHeadClass,
  filterableTableThClass,
  filterableTableHeaderLabelClass,
} from "~/components/data-table";

const RUOLO_OPTIONS = ["admin", "manager", "mediatore", "Ospite"].map((value) => ({ value, label: value }));
const SORT_FIELDS = ["email", "name", "ruolo_corrente", "stato"] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin");
  const { pb } = await createPB(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim()?.toLowerCase() ?? "";
  const ruolo = url.searchParams.get("ruolo")?.trim() ?? "";
  const sortField = SORT_FIELDS.includes(url.searchParams.get("sort") as (typeof SORT_FIELDS)[number])
    ? (url.searchParams.get("sort") as (typeof SORT_FIELDS)[number])
    : "name";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  let users: { id: string; email: string; name: string; ruolo_corrente: string; ruoli: string[]; stato: boolean }[] = [];
  let loadError: string | null = null;

  try {
    const list = (await pb.collection("users").getFullList()) as Record<string, unknown>[];
    users = list.map((u) => ({
      id: u.id as string,
      email: (u.email as string) ?? "",
      name: (u.name as string) ?? "",
      ruolo_corrente: (u.ruolo_corrente as string) ?? "",
      ruoli: Array.isArray(u.ruoli) ? (u.ruoli as string[]) : [],
      stato: u.stato === true || (typeof u.stato !== "boolean" && u.stato !== false),
    }));
  } catch (e) {
    loadError = "Impossibile caricare l'elenco utenti. Verificare i permessi della collection users.";
  }

  if (q) {
    const ql = q.toLowerCase();
    users = users.filter(
      (u) =>
        u.email.toLowerCase().includes(ql) ||
        u.name.toLowerCase().includes(ql)
    );
  }
  if (ruolo) {
    users = users.filter(
      (u) => u.ruolo_corrente === ruolo || (Array.isArray(u.ruoli) && u.ruoli.includes(ruolo))
    );
  }

  users.sort((a, b) => {
    const rawA = (a as Record<string, unknown>)[sortField];
    const rawB = (b as Record<string, unknown>)[sortField];
    let va: string = sortField === "stato"
      ? (rawA ? "1" : "0")
      : String(rawA ?? "").toLowerCase();
    let vb: string = sortField === "stato"
      ? (rawB ? "1" : "0")
      : String(rawB ?? "").toLowerCase();
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return order === "asc" ? cmp : -cmp;
  });

  return json({
    users,
    loadError,
    filters: { q, ruolo },
    sortField,
    order,
  });
}

export default function AdminUtentiIndex() {
  const { users, loadError, filters, sortField, order } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-base-content mb-4">Gestione utenti</h1>

      {loadError && (
        <div className="alert alert-warning mb-4">
          <span>{loadError}</span>
        </div>
      )}

      <FilterableTable
        id="admin-utenti-filters-form"
        method="get"
        hiddenFields={{ sort: sortField, order }}
      >
        <table className="table table-zebra table-sm">
          <thead className={filterableTableHeadClass}>
            <tr>
              <th className={`${filterableTableThClass} min-w-[140px]`}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Email" field="email" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
                <FilterTextInput name="q" type="search" defaultValue={filters.q} placeholder="Cerca…" />
              </th>
              <th className={filterableTableThClass}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Nome" field="name" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
              </th>
              <th className={`${filterableTableThClass} min-w-[120px]`}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Ruolo corrente" field="ruolo_corrente" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
                <FilterSelect name="ruolo" defaultValue={filters.ruolo} options={RUOLO_OPTIONS} emptyLabel="Tutti" />
              </th>
              <th className={filterableTableThClass}>
                <div className={filterableTableHeaderLabelClass}>Ruoli</div>
              </th>
              <th className={filterableTableThClass}>
                <div className={filterableTableHeaderLabelClass}>
                  <SortLink label="Stato" field="stato" currentSort={sortField} currentOrder={order} searchParams={searchParams} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !loadError ? (
              <tr>
                <td colSpan={5} className="text-center text-base-content/70 py-8">
                  Nessun utente trovato.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover">
                  <td>
                    <Link to={`/admin/utenti/${u.id}`} className="link link-hover font-medium">
                      {u.email}
                    </Link>
                  </td>
                  <td>{u.name || "—"}</td>
                  <td>{u.ruolo_corrente || "—"}</td>
                  <td>{Array.isArray(u.ruoli) ? u.ruoli.join(", ") : "—"}</td>
                  <td>{u.stato ? "Attivo" : "Disattivo"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </FilterableTable>
    </div>
  );
}
