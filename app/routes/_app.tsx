import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser, canSeeFatture, isAdmin } from "~/lib/auth.server";
import { createPB, getPocketbaseBaseUrl } from "~/lib/pocketbase.server";
import { TopNav } from "~/components/layout/top-nav";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const role = user.ruolo_corrente ?? user.ruoli?.[0];
  const baseUrl = getPocketbaseBaseUrl();
  const avatarUrl =
    user.avatar && user.id
      ? `${baseUrl}/api/files/users/${user.id}/${user.avatar}`
      : null;

  let unreadNotifiche = 0;
  try {
    const unread = await pb.collection("notifiche").getList(1, 1, {
      filter: `destinatario = "${user.id}" && letto = false`,
      fields: "id",
    });
    unreadNotifiche = unread.totalItems ?? 0;
  } catch {
    unreadNotifiche = 0;
  }

  return json({
    user,
    avatarUrl,
    showFatture: canSeeFatture(role),
    showAdmin: isAdmin(role),
    unreadNotifiche,
  });
}

export default function AppLayout() {
  const { user, avatarUrl, showFatture, showAdmin, unreadNotifiche } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const fullBleed = pathname.startsWith("/mediazioni/calendario");

  return (
    <div className={`min-h-screen ${fullBleed ? "bg-[var(--cal-bg)]" : "bg-base-200"}`}>
      <TopNav
        user={user}
        avatarUrl={avatarUrl}
        showFatture={showFatture}
        showAdmin={showAdmin}
        unreadNotifiche={unreadNotifiche}
      />
      <main
        className={
          fullBleed
            ? "w-full max-w-none px-0 py-0"
            : "mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
        }
      >
        <Outlet />
      </main>
    </div>
  );
}
