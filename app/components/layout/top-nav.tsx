import { Link, Form, useLocation } from "@remix-run/react";
import { useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import type { PbUser } from "~/types";
import { ThemeToggle } from "~/components/theme-toggle";

function navLinkClass(path: string, currentPath: string) {
  let isActive: boolean;
  if (path === "/dashboard") {
    isActive = currentPath === "/dashboard";
  } else if (path === "/mediazioni") {
    // Keep Calendario as its own nav item
    isActive =
      (currentPath === "/mediazioni" || currentPath.startsWith("/mediazioni/")) &&
      !currentPath.startsWith("/mediazioni/calendario");
  } else if (path === "/mediazioni/calendario") {
    isActive = currentPath.startsWith("/mediazioni/calendario");
  } else {
    isActive = currentPath === path || currentPath.startsWith(path + "/");
  }
  return isActive
    ? "btn btn-sm bg-primary/15 text-primary border-transparent hover:bg-primary/20"
    : "btn btn-ghost btn-sm";
}

const ChevronDown = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="h-4 w-4 ml-1 opacity-70"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

export function TopNav({
  user,
  avatarUrl,
  showFatture,
  showAdmin,
  unreadNotifiche = 0,
}: {
  user: PbUser;
  avatarUrl: string | null;
  showFatture: boolean;
  showAdmin: boolean;
  unreadNotifiche?: number;
}) {
  const { pathname } = useLocation();
  const mobileAdminRef = useRef<HTMLDetailsElement | null>(null);
  const desktopAdminRef = useRef<HTMLDetailsElement | null>(null);
  const userMenuRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (mobileAdminRef.current) {
      mobileAdminRef.current.open = false;
    }
    if (desktopAdminRef.current) {
      desktopAdminRef.current.open = false;
    }
    if (userMenuRef.current) {
      userMenuRef.current.open = false;
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
              <Link
                to="/mediazioni/calendario"
                className={navLinkClass("/mediazioni/calendario", pathname)}
              >
                Calendario
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
        <ul className="menu menu-horizontal px-1 gap-0.5">
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
            <Link
              to="/mediazioni/calendario"
              className={navLinkClass("/mediazioni/calendario", pathname)}
            >
              Calendario
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
      <div className="navbar-end gap-1.5">
        <ThemeToggle />
        <Link
          to="/notifiche"
          className={`btn btn-ghost btn-sm btn-square relative ${pathname.startsWith("/notifiche") ? "bg-primary/15 text-primary" : ""}`}
          aria-label="Notifiche"
          title="Notifiche"
        >
          <Bell className="h-5 w-5" />
          {unreadNotifiche > 0 && (
            <span className="badge badge-error badge-xs absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-4 px-1">
              {unreadNotifiche > 99 ? "99+" : unreadNotifiche}
            </span>
          )}
        </Link>
        <details ref={userMenuRef} className="dropdown dropdown-end">
          <summary
            className={`btn btn-ghost btn-sm marker:content-none list-none flex items-center gap-1 ${pathname === "/settings" ? "bg-primary/15 text-primary" : ""}`}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-base-300 text-base-content/70 text-xs font-medium">
                {(user.name || user.email || "?").charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-sm text-base-content/70 max-w-[120px] truncate">
              {user.name || user.email} · {user.ruolo_corrente ?? user.ruoli?.[0] ?? "—"}
            </span>
            <ChevronDown />
          </summary>
          <ul
            tabIndex={0}
            className="menu menu-sm dropdown-content mt-2 z-40 p-2 shadow bg-base-100 rounded-box w-52 border border-base-300"
          >
            <li>
              <Link to="/settings">Modifica profilo</Link>
            </li>
            <li>
              <Form method="post" action="/logout">
                <button type="submit" className="w-full text-left">
                  Esci
                </button>
              </Form>
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}
