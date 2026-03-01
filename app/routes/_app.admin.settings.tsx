import { Outlet } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUserAndRole } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserAndRole(request, "admin");
  return json({});
}

export default function AdminSettingsLayout() {
  return <Outlet />;
}

