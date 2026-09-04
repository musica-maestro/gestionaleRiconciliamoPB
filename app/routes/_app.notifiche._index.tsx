import { Form, Link, useFetcher, useLoaderData } from "@remix-run/react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Bell, CheckCheck } from "lucide-react";
import { requireUser } from "~/lib/auth.server";
import { createPB } from "~/lib/pocketbase.server";

export const meta = () => [{ title: "Notifiche" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);

  const result = await pb.collection("notifiche").getList(1, 100, {
    filter: `destinatario = "${user.id}"`,
    sort: "-created",
  });

  return json({
    items: result.items.map((n) => {
      const mediazioni = Array.isArray(n.mediazioni)
        ? (n.mediazioni as unknown[]).map((id) => String(id)).filter(Boolean)
        : [];
      return {
        id: String(n.id),
        tipo: String(n.tipo ?? ""),
        messaggio: String(n.messaggio ?? ""),
        dettaglio: n.dettaglio ? String(n.dettaglio) : "",
        letto: Boolean(n.letto),
        count: typeof n.count === "number" ? n.count : Number(n.count ?? 0),
        created: n.created ? String(n.created) : "",
        mediazioni,
      };
    }),
  });
}

function notificationHref(n: { tipo: string; mediazioni: string[] }) {
  if (n.tipo === "adesione" && n.mediazioni[0]) {
    return `/mediazioni/${n.mediazioni[0]}`;
  }
  return "/mediazioni?tab=da-pianificare";
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const { pb } = await createPB(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "mark_read") {
    const id = String(formData.get("id") ?? "");
    if (id) await pb.collection("notifiche").update(id, { letto: true });
    return json({ ok: true });
  }
  if (intent === "mark_all_read") {
    const unread = await pb.collection("notifiche").getFullList({
      filter: `destinatario = "${user.id}" && letto = false`,
      fields: "id",
    });
    for (const n of unread) {
      await pb.collection("notifiche").update(n.id, { letto: true });
    }
    return json({ ok: true });
  }
  return json({ error: "Intent non valido" }, 400);
}

function formatRelative(iso: string) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "ora";
  if (mins < 60) return `${mins} min fa`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h fa`;
  return `${Math.round(hours / 24)} g fa`;
}

export default function NotifichePage() {
  const { items } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const unread = items.filter((i) => !i.letto);
  const read = items.filter((i) => i.letto);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Bell className="h-6 w-6" /> Notifiche
        </h1>
        {unread.length > 0 && (
          <Form method="post">
            <input type="hidden" name="intent" value="mark_all_read" />
            <button type="submit" className="btn btn-ghost btn-sm gap-1">
              <CheckCheck className="h-4 w-4" /> Segna tutte come lette
            </button>
          </Form>
        )}
      </div>

      {items.length === 0 && (
        <p className="text-base-content/60">Nessuna notifica.</p>
      )}

      {unread.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content/50 mb-3">
            Non lette ({unread.length})
          </h2>
          <ul className="space-y-2">
            {unread.map((n) => (
              <li key={n.id} className="rounded-lg border border-primary/30 bg-base-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{n.messaggio}</p>
                    {n.dettaglio && <p className="text-sm text-base-content/60 mt-1">{n.dettaglio}</p>}
                    <p className="text-xs text-base-content/50 mt-2">
                      {n.tipo} · {formatRelative(n.created)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <Link
                      to={notificationHref(n)}
                      className="btn btn-primary btn-xs"
                      onClick={() =>
                        fetcher.submit(
                          { intent: "mark_read", id: n.id },
                          { method: "post" },
                        )
                      }
                    >
                      Apri
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() =>
                        fetcher.submit(
                          { intent: "mark_read", id: n.id },
                          { method: "post" },
                        )
                      }
                    >
                      Segna letta
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {read.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content/50 mb-3">
            Lette
          </h2>
          <ul className="space-y-2">
            {read.map((n) => (
              <li key={n.id} className="rounded-lg border border-base-300 bg-base-100/70 p-4 opacity-80">
                <p className="font-medium">{n.messaggio}</p>
                <p className="text-xs text-base-content/50 mt-2">
                  {n.tipo} · {formatRelative(n.created)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
