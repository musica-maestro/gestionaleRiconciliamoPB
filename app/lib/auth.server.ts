import { redirect } from "@remix-run/node";
import { getSession, commitSession, destroySession, SESSION_PB_TOKEN_KEY, SESSION_USER_KEY } from "./session.server";
import type { PbUser } from "~/types";

const ROLES = ["admin", "manager", "mediatore"] as const;
export type Role = (typeof ROLES)[number];

/** Resolve current role from user (handles ruoli as string or array from PocketBase). */
export function getCurrentRole(user: PbUser | null): string | undefined {
  if (!user) return undefined;
  const r = user.ruolo_corrente ?? (Array.isArray(user.ruoli) ? user.ruoli[0] : user.ruoli);
  return typeof r === "string" ? r : undefined;
}

export function isActiveUser(user: PbUser | null): boolean {
  if (!user) return false;
  // stato can be boolean (new schema) or undefined
  if (typeof user.stato === "boolean") return user.stato === true;
  return true;
}

/**
 * Require a logged-in user. Redirects to /login if not authenticated.
 * Returns the user from session (does not re-fetch from PB).
 */
export async function requireUser(request: Request): Promise<PbUser> {
  const session = await getSession(request.headers.get("Cookie"));
  const user = session.get(SESSION_USER_KEY) as PbUser | undefined;
  const token = session.get(SESSION_PB_TOKEN_KEY);

  if (!token || !user?.id) {
    throw redirect("/login", {
      headers: { "Set-Cookie": await destroySession(session) },
    });
  }

  if (!isActiveUser(user)) {
    throw redirect("/login?error=disabled", {
      headers: { "Set-Cookie": await destroySession(session) },
    });
  }

  return user;
}

/**
 * Require user to have one of the given roles. Use after requireUser in loader/action.
 */
export function requireRole(user: PbUser, ...allowed: Role[]): void {
  const role = getCurrentRole(user);
  if (!role || !allowed.includes(role as Role)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

/**
 * Require user and role in one call. Returns user.
 */
export async function requireUserAndRole(
  request: Request,
  ...allowed: Role[]
): Promise<PbUser> {
  const user = await requireUser(request);
  requireRole(user, ...allowed);
  return user;
}

export function canSeeFatture(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function isAdmin(role: string | undefined): boolean {
  return role === "admin";
}
