import { getPocketbaseBaseUrl } from "~/lib/pocketbase.server";
import { getSession, SESSION_PB_TOKEN_KEY } from "~/lib/session.server";

/** Call a custom Go route on the same PocketBase host, forwarding the session token. */
export async function callRiconciliamoApi(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = await getSession(request.headers.get("Cookie"));
  const token = session.get(SESSION_PB_TOKEN_KEY) as string | undefined;
  if (!token) {
    throw new Response("Non autenticato", { status: 401 });
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${getPocketbaseBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, { ...init, headers });
}
