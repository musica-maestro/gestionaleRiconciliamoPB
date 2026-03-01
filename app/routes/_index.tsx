import { redirect } from "@remix-run/node";
import { createPB } from "~/lib/pocketbase.server";

export async function loader({ request }: { request: Request }) {
  const { user } = await createPB(request);
  if (user?.id) {
    throw redirect("/dashboard");
  }
  throw redirect("/login");
}
