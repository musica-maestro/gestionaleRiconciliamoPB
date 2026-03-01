import { redirect } from "@remix-run/node";
import { getSession, destroySession } from "~/lib/session.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return redirect("/dashboard");
  }
  const session = await getSession(request.headers.get("Cookie"));
  return redirect("/login", {
    headers: { "Set-Cookie": await destroySession(session) },
  });
}
