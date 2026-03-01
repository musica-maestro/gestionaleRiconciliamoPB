# Gestionale Mediazioni

Remix (Vite) + PocketBase app for managing mediazioni, rubrica, fatture and users.

## Prerequisiti

- **PocketBase** in esecuzione (es. `http://127.0.0.1:8090`) con le collection e gli utenti configurati.
- **Node 18+** e **pnpm**.

## Setup

```bash
pnpm install
cp .env.example .env   # opzionale: imposta POCKETBASE_URL e SESSION_SECRET
```

## Script

| Comando        | Descrizione                |
|----------------|----------------------------|
| `pnpm run dev` | Dev server (HMR)           |
| `pnpm run build` | Build di produzione      |
| `pnpm run start` | Avvia il server di build |
| `pnpm run typecheck` | Controllo TypeScript   |

## Ruoli e accesso

- **mediatore**: vede solo le mediazioni assegnate; nessun menu Fatture.
- **manager**: vede tutte le mediazioni e le fatture; non gestisce utenti.
- **admin**: accesso completo incluso gestione utenti in Admin.

Utenti con `stato = false` non possono accedere (messaggio "Account disattivato.").

## Route principali

- `/` → redirect a `/dashboard` (se loggato) o `/login`
- `/login` → login con email/password
- `/dashboard` → prima pagina dopo il login
- `/mediazioni` → elenco mediazioni (filtrato per mediatore)
- `/rubrica` → soggetti e avvocati
- `/fatture` → solo manager/admin
- `/admin/utenti` → solo admin

Logout: pulsante "Esci" nel menu (POST `/logout`).
