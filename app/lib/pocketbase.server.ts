import PocketBase from "pocketbase";
import { getSession } from "./session.server";
import type { PbUser } from "~/types";

const POCKETBASE_URL = process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090";

export type { PbUser };

/**
 * Create a PocketBase client for server-side use.
 * Restores auth from session cookie if present.
 */
export async function createPB(request: Request): Promise<{
  pb: PocketBase;
  user: PbUser | null;
}> {
  const pb = new PocketBase(POCKETBASE_URL);
  const session = await getSession(request.headers.get("Cookie"));
  const token = session.get("pb_token");

  if (token) {
    const user = session.get("user") as PbUser | undefined;
    pb.authStore.save(token, user ?? undefined);
    // Use session user; skip authRefresh to avoid 400 from PB auth collection rules
    return { pb, user: user ?? null };
  }

  return { pb, user: null };
}

/**
 * Get a fresh PocketBase instance without auth (e.g. for login).
 */
export function getPocketBase(): PocketBase {
  return new PocketBase(POCKETBASE_URL);
}
