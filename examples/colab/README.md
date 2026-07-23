# Collaborative PDF application

This workspace is a deployable single-viewer collaboration application, not a
two-pane demo. It contains a static React client, a Node.js WebSocket/HTTP
relay, durable session/PDF storage, and member-approved admission. The relay
and the old in-memory integration-test fixture remain application code.

No deployment hostname, public path, or production port is committed here.
Every deployment-specific value is supplied through environment variables.

## Local development

Install dependencies with Node.js 20.19 or newer (or Node.js 22.13 or newer)
and npm, then run this from the repository root:

```sh
npm run dev:colab
```

The command owns both fixed development ports: Vite on `5173` and the Node.js
relay on `5191`. Vite proxies `/api` and `/relay` to the relay. Development data is
stored under `var/colab/` and ignored by Git.

Vite accepts hosts under `.ts.net`, so the complete local stack can be exposed
temporarily by pointing Tailscale Funnel at the Vite port. Keep Funnel's target
at the client origin rather than exposing port `5191` separately: normal HTTP,
`/api`, and the `/relay` WebSocket upgrade then share one HTTPS origin.

```sh
tailscale funnel --bg 5173
```

The browser derives `wss://<current-host>/relay` when loaded over Funnel HTTPS,
and Vite proxies that upgraded connection to the relay.

The first screen creates a session from a PDF or requests admission to an
existing session. Any currently connected member may approve a request. Each
approved device receives a random membership token, stored locally and never
included in the shared URL.

Opening a shared `?session=...` URL shows a join-only screen: the create/join
switch and internal session id are hidden, and the public session name is
shown. Manual id entry is not exposed; participants join through the invitation
link. The creation form tells the creator that the session name will be visible
on the join screen.

The active-session header keeps the session name, an `招待用リンク` copy button,
and the current participant in one row. Clicking the participant name edits
the locally stored display name. It also shows relay connection state, the
number of distinct connected participants, and elapsed time since session
creation. Leaving requires confirmation.

The viewer does not expose the internal committed-operation feed. After a
previously successful relay connection drops, it shows a reconnecting banner
while the client retries automatically. Actionable error details remain
visible as dismissible alerts.

Revision mismatches also force a reconnect and authoritative snapshot restore,
including removal or rollback of local annotation and form edits that were
never accepted by the relay.

Any connected member may also reject a request. Approval or rejection is
broadcast to all connected members so the request disappears everywhere.
Rejected devices can reapply after an enforced cooldown that increases with
each rejection: 5 seconds, 10 seconds, 15 seconds, and so on.

## Static client build

Copy `.env.production.example` to an untracked deployment environment or export
equivalent variables:

```text
PDFRX_PUBLIC_BASE=/path/to/static-client/
VITE_PDFRX_API_BASE=/path/to/api
VITE_PDFRX_RELAY_URL=wss://example.invalid/path/to/relay
VITE_PDFRX_WASM_URL=/path/to/static-client/pdfium/
```

Then run:

```sh
npm run build --workspace=@pdfrx/example-colab
```

Publish the complete `dist/` directory, including `pdfium/`. Values prefixed
with `VITE_` are public client configuration and must never contain secrets.

## Relay server

Configure the process using environment variables:

```text
PDFRX_HOST=127.0.0.1
PDFRX_PORT=5191
PDFRX_DATA_DIR=/absolute/writable/data/directory
PDFRX_API_PREFIX=/path/to/api
PDFRX_RELAY_PATH=/path/to/relay
PDFRX_MAX_SOURCE_BYTES=52428800
```

Start it with:

```sh
npm run start --workspace=@pdfrx/example-colab
```

The npm script runs the TypeScript entry point on Node.js through `tsx`.

The reverse proxy must forward HTTP requests under `PDFRX_API_PREFIX`, forward
WebSocket upgrades at `PDFRX_RELAY_PATH`, terminate TLS, preserve request
bodies and `X-Pdfrx-Member-Token`, and configure suitable body/idle/WebSocket
timeouts. `GET <api-prefix>/health` is the health check.

## Persistence and backup

Each session is stored below `PDFRX_DATA_DIR/<session-id>/`:

```text
state.json
sources/
  main.pdf
  <imported-document-id>.pdf
```

State writes use a temporary file followed by an atomic rename. Accepted
operations are broadcast only after the new state is durable. Back up the whole
data directory; restoring only state or only sources is incomplete.

Only SHA-256 hashes of random membership tokens are persisted. A new device
must be approved by any currently connected member. If every admitted device
loses its local token, an administrative recovery command is currently needed
but has not yet been implemented.

## Production boundary

This application supports one relay process with persistent local storage.
Multiple instances against one directory are unsupported: operation sequencing
and WebSocket membership are process-local. Multi-instance deployment requires
a shared database, distributed sequencing, and pub/sub.

The server does not yet provide user accounts, read-only roles, audit-log
retention, per-user quotas, antivirus scanning, or administrative deletion.
Use TLS, restrictive filesystem permissions, backups, and disk monitoring.
