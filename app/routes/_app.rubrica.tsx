import { useState } from "react";
import { Outlet } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/auth.server";
import { NewRubricaEntryDialog } from "~/components/new-rubrica-entry-dialog";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  return json({});
}

export default function RubricaLayout() {
  const [newEntryDialogOpen, setNewEntryDialogOpen] = useState(false);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold text-base-content shrink-0">Rubrica</h1>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setNewEntryDialogOpen(true)}
            className="btn btn-primary btn-sm"
          >
            Nuova voce
          </button>
        </div>
      </div>
      <Outlet />
      <NewRubricaEntryDialog
        isOpen={newEntryDialogOpen}
        onClose={() => setNewEntryDialogOpen(false)}
      />
    </div>
  );
}
