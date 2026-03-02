import { Outlet, useLoaderData } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser, canSeeFatture, isAdmin } from "~/lib/auth.server";
import { getPocketbaseBaseUrl } from "~/lib/pocketbase.server";
import { TopNav } from "~/components/layout/top-nav";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const role = user.ruolo_corrente ?? user.ruoli?.[0];
  const baseUrl = getPocketbaseBaseUrl();
  const avatarUrl =
    user.avatar && user.id
      ? `${baseUrl}/api/files/users/${user.id}/${user.avatar}`
      : null;
  return json({
    user,
    avatarUrl,
    showFatture: canSeeFatture(role),
    showAdmin: isAdmin(role),
  });
}

export default function AppLayout() {
  const { user, avatarUrl, showFatture, showAdmin } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-base-200">
      <TopNav
        user={user}
        avatarUrl={avatarUrl}
        showFatture={showFatture}
        showAdmin={showAdmin}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
