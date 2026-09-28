# @vellum/server

The Vellum server: a small Fastify app backed by SQLite (Node's built-in `node:sqlite`).

- `GET /api/health` — liveness and version.
- `GET /sync/:docId` (WebSocket) — document sync. The protocol is the y-websocket framing plus a Vellum
  `Ack` message sent after each update batch is durably stored (see `packages/core/src/sync`).
- Serves the built web app when `VELLUM_WEB_DIST` points at `apps/web/dist`.

```sh
pnpm dev:server                    # watch mode on http://127.0.0.1:8787
pnpm --filter @vellum/server build # bundle to dist/main.js
node apps/server/dist/main.js
```

| Variable            | Default                  | Meaning                  |
| ------------------- | ------------------------ | ------------------------ |
| `HOST`              | `127.0.0.1`              | Interface to bind        |
| `PORT`              | `8787`                   | Port                     |
| `VELLUM_DATA_DIR`   | `./data`                 | Where `vellum.db` lives  |
| `VELLUM_WEB_DIST`   | unset                    | Built web app to serve   |
| `VELLUM_PUBLIC_URL` | `http://localhost:$PORT` | Public URL used in links |
| `LOG_LEVEL`         | `info`                   | Pino log level           |

## How saving works

1. Every edit is a Yjs update. The browser writes it to IndexedDB immediately (crash-safe).
2. Updates are batched for 400 ms and sent over the socket (debounced autosave).
3. The server appends the update to `doc_updates`, then replies with an `Ack` carrying its state vector.
4. The client shows **Saved** only when the acknowledged state covers every local edit. Without a
   connection it shows **Offline**; edits stay on the device and sync on reconnect. Concurrent edits
   merge through the CRDT, so nothing is clobbered.
