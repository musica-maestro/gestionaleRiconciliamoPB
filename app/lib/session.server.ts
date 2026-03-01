import { createCookieSessionStorage } from "@remix-run/node";

const sessionSecret = process.env.SESSION_SECRET ?? "gestionale-dev-secret-change-in-prod";

export const { getSession, commitSession, destroySession } =
  createCookieSessionStorage({
    cookie: {
      name: "__session",
      secrets: [sessionSecret],
      sameSite: "lax",
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7, // 1 week
    },
  });

export const SESSION_PB_TOKEN_KEY = "pb_token";
export const SESSION_USER_KEY = "user";
