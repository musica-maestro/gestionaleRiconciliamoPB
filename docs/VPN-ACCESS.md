# Accesso solo da VPN (WireGuard Easy)

Puoi limitare l’accesso al Gestionale ai soli client connessi alla VPN WireGuard Easy (o a un’altra rete che usi). Due modi: **Docker con Traefik** (stack autonomo) oppure **Coolify** (aggiunta di label Traefik alla risorsa già deployata).

---

## 1. Docker: stack VPN-only (senza Coolify)

Usa il compose che include Traefik e l’IP allowlist. Solo gli IP nella subnet della VPN (default WireGuard Easy `10.8.0.0/24`) possono raggiungere l’app.

1. Crea `.env` da `.env.example` e imposta almeno `POCKETBASE_URL` e `SESSION_SECRET`.
2. Opzionale: imposta `DOMAIN` (es. `gestionale.tuodominio.it`) e, se la tua VPN non usa `10.8.0.0/24`, imposta `VPN_SOURCERANGE` (es. `10.13.13.0/24`).
3. Avvia lo stack:

```bash
docker compose -f docker-compose.vpn.yml up -d
```

L’app è in ascolto sulla porta **80** (Traefik). Accedi via `http://<server-ip>/` o `http://<DOMAIN>/` solo da un client connesso alla VPN.

---

## 2. Coolify: VPN-only sulla risorsa già deployata

Coolify usa Traefik. Per applicare l’IP allowlist solo al Gestionale devi aggiungere due label alla risorsa (middleware + attacco al router). Il nome del router lo trovi nel “Deployable Compose”.

### Passo 1 – Nome del router

1. In Coolify apri il **progetto** che contiene il Gestionale.
2. Apri la **risorsa** (applicazione) del Gestionale.
3. Vai dove si modifica il **Compose / Docker** (es. “Edit”, “Docker Compose”, “Show Deployable Compose”).
4. Apri **“Show Deployable Compose”** (o equivalente) e cerca una riga tipo:
   ```text
   traefik.http.routers.https-0-XXXXXXXX.middlewares=gzip
   ```
   (o `http-0-XXXXXXXX`). Il nome del router è la parte `https-0-XXXXXXXX` (o `http-0-XXXXXXXX`). **Copialo** (es. `https-0-wc04wo4ow4scokgsw8wow4s8`).

### Passo 2 – Label da aggiungere

Aggiungi queste label al **servizio** del Gestionale (nella stessa sezione dove Coolify mostra le label Traefik):

**a) Definizione del middleware (IP allowlist)**  
(usa la subnet della tua VPN; sotto è quella standard di WireGuard Easy)

```text
traefik.http.middlewares.gestionale-vpnonly.ipallowlist.sourcerange=10.8.0.0/24
```

Se la tua VPN usa un’altra subnet (es. in WireGuard Easy l’hai cambiata), mettila qui, es. `10.13.13.0/24`.

**b) Attacco del middleware al router**  
Sostituisci `<ROUTER_NAME>` con il nome copiato al passo 1 (es. `https-0-wc04wo4ow4scokgsw8wow4s8`).  
Se nella deployable compose c’è già qualcosa tipo `middlewares=gzip`, aggiungi `,gestionale-vpnonly` **dopo**:

```text
traefik.http.routers.<ROUTER_NAME>.middlewares=gzip,gestionale-vpnonly
```

Esempio con router `https-0-wc04wo4ow4scokgsw8wow4s8`:

```text
traefik.http.routers.https-0-wc04wo4ow4scokgsw8wow4s8.middlewares=gzip,gestionale-vpnonly
```

Salva e ridistribuisci la risorsa. Da quel momento solo i client con IP nella subnet configurata (es. `10.8.0.0/24`) potranno aprire il Gestionale; gli altri riceveranno 403.

---

## Subnet di default

- **WireGuard Easy** (default): `10.8.0.0/24` (client `10.8.0.2`, `10.8.0.3`, …).
- Se in WireGuard Easy hai cambiato la subnet (es. da pannello o con `WG_DEFAULT_ADDRESS`), usa quella in `sourcerange` o in `VPN_SOURCERANGE` nel compose.
