import { Outlet } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  return json({});
}

export default function MediazioniLayout() {
  return (
    <div>
      <Outlet />
    </div>
  );
}
