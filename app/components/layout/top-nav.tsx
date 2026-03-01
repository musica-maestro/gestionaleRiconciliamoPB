import { Link, Form, useLocation } from "@remix-run/react";
import { useEffect, useRef } from "react";
import type { PbUser } from "~/types";

function navLinkClass(path: string, currentPath: string) {
  const isActive =
    path === "/dashboard"
      ? currentPath === "/dashboard"
      : currentPath === path || currentPath.startsWith(path + "/");
  return isActive ? "btn btn-primary btn-sm m-2" : "btn btn-ghost btn-sm m-2";
}

export function TopNav({
  user,
  showFatture,
  showAdmin,
}: {
  user: PbUser;
  showFatture: boolean;
  showAdmin: boolean;
}) {
  const { pathname } = useLocation();
  const mobileAdminRef = useRef<HTMLDetailsElement | null>(null);
  const desktopAdminRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (mobileAdminRef.current) {
      mobileAdminRef.current.open = false;
    }
    if (desktopAdminRef.current) {
      desktopAdminRef.current.open = false;
    }
  }, [pathname]);

  return (
    <div className="navbar sticky top-0 bg-base-100 border-b-2 border-primary z-30">
      <div className="navbar-start">
        <div className="dropdown">
          <button
            type="button"
            tabIndex={0}
            className="btn btn-ghost lg:hidden"
            aria-label="Apri menu di navigazione"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h8m-8 6h16" />
            </svg>
          </button>
          <ul
            tabIndex={0}
            className="menu menu-sm dropdown-content mt-3 z-40 p-2 shadow bg-base-100 rounded-box w-52"
          >
            <li>
              <Link to="/dashboard" className={navLinkClass("/dashboard", pathname)}>
                Dashboard
              </Link>
            </li>
            <li>
              <Link to="/mediazioni" className={navLinkClass("/mediazioni", pathname)}>
                Mediazioni
              </Link>
            </li>
            <li>
              <Link to="/rubrica" className={navLinkClass("/rubrica", pathname)}>
                Rubrica
              </Link>
            </li>
            {showFatture && (
              <li>
                <Link to="/fatture" className={navLinkClass("/fatture", pathname)}>
                  Fatture
                </Link>
              </li>
            )}
            {showAdmin && (
              <li>
                <details ref={mobileAdminRef}>
                  <summary className="font-semibold marker:content-none">
                    Admin
                  </summary>
                  <ul className="menu menu-sm p-2 bg-base-100 rounded-box items-start">
                    <li>
                      <Link to="/admin/utenti" className={navLinkClass("/admin/utenti", pathname)}>
                        Gestione utenti
                      </Link>
                    </li>
                    <li>
                      <Link to="/admin/settings" className={navLinkClass("/admin/settings", pathname)}>
                        Impostazioni applicazione
                      </Link>
                    </li>
                  </ul>
                </details>
              </li>
            )}
          </ul>
        </div>
        <Link to="/dashboard" className="btn btn-ghost p-0 normal-case">
          <img
            src="/riconciliamo.svg"
            alt="Riconciliamo"
            className="h-8 w-auto"
          />
        </Link>
      </div>
      <div className="navbar-center hidden lg:flex">
        <ul className="menu menu-horizontal px-1">
          <li>
            <Link to="/dashboard" className={navLinkClass("/dashboard", pathname)}>
              Dashboard
            </Link>
          </li>
          <li>
            <Link to="/mediazioni" className={navLinkClass("/mediazioni", pathname)}>
              Mediazioni
            </Link>
          </li>
          <li>
            <Link to="/rubrica" className={navLinkClass("/rubrica", pathname)}>
              Rubrica
            </Link>
          </li>
          {showFatture && (
            <li>
              <Link to="/fatture" className={navLinkClass("/fatture", pathname)}>
                Fatture
              </Link>
            </li>
          )}
          {showAdmin && (
            <li>
              <details ref={desktopAdminRef}>
                <summary
                  className={`${navLinkClass("/admin", pathname)} marker:content-none`}
                >
                  Admin
                </summary>
                <ul className="menu menu-sm bg-base-100 rounded-t-none p-2 shadow items-start">
                  <li>
                    <Link to="/admin/utenti" className={navLinkClass("/admin/utenti", pathname)}>
                      Gestione utenti
                    </Link>
                  </li>
                  <li>
                    <Link to="/admin/settings" className={navLinkClass("/admin/settings", pathname)}>
                      Impostazioni applicazione
                    </Link>
                  </li>
                </ul>
              </details>
            </li>
          )}
        </ul>
      </div>
      <div className="navbar-end gap-2">
        <span className="text-sm text-base-content/70">
          {user.name || user.email} · {user.ruolo_corrente ?? user.ruoli?.[0] ?? "—"}
        </span>
        <Link
          to="/settings"
          className={pathname === "/settings" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
        >
          Impostazioni
        </Link>
        <Form method="post" action="/logout">
          <button type="submit" className="btn btn-ghost btn-sm">
            Esci
          </button>
        </Form>
      </div>
    </div>
  );
}
