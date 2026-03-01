import { Outlet, useLoaderData } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser, canSeeFatture, isAdmin } from "~/lib/auth.server";
import { TopNav } from "~/components/layout/top-nav";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = user.ruolo_corrente ?? user.ruoli?.[0];
  return json({
    user,
    showFatture: canSeeFatture(role),
    showAdmin: isAdmin(role),
  });
}

export default function AppLayout() {
  const { user, showFatture, showAdmin } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-base-200">
      <TopNav user={user} showFatture={showFatture} showAdmin={showAdmin} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
