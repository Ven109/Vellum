# ADR 0001 — Yjs as the single source of truth for document state

- **Status:** Accepted
- **Work item:** VEL-5 (spike: CRDT-based local-first sync)

## Context

Vellum needs offline editing on the desktop, realtime collaboration on the web, comment anchors that
survive edits, and version history. Building each on its own mechanism (last-write-wins autosave,
operational transform for collaboration, text diffs for history) would give three sources of truth and
three classes of bugs. The spike asked whether one CRDT can carry all of it, and whether that should be
**Yjs** or **Automerge**.

## Options compared

| Criterion                   | Yjs                                                                   | Automerge 3                                        |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| Rich-text editor binding    | `y-prosemirror` — mature, used by TipTap's Collaboration extension    | `automerge-prosemirror` — newer, smaller user base |
| Stable anchors for comments | `RelativePosition` — built in, survives concurrent edits              | Cursors / marks — available, less battle-tested    |
| Presence                    | `y-protocols/awareness` — standard                                    | Separate ephemeral messages, roll your own         |
| Self-hostable sync server   | Tiny protocol (`y-protocols/sync`), trivial to embed in our server    | `automerge-repo` sync server — fine, heavier       |
| Bundle size (min+gz, core)  | ~20 KB, pure JS                                                       | Larger; Rust core compiled to WASM                 |
| Full history / time travel  | Snapshots when GC is off; we store explicit versions instead          | Full history is inherent (a strength)              |
| Offline persistence         | `y-indexeddb` in browsers; binary updates in SQLite on desktop/server | `automerge-repo` storage adapters                  |

## Decision

Use **Yjs** as the single source of truth for live document state.

- Each document is a `Y.Doc` holding a `Y.XmlFragment` (`"content"`) bound to ProseMirror via
  `y-prosemirror`, plus small maps for per-document metadata.
- Clients persist locally (IndexedDB in the browser, SQLite in the desktop app) and sync through
  `SyncSession` (`packages/core/src/sync`) over any transport. The wire format is the y-websocket
  framing, so the Vellum server is also just a Yjs relay-and-store — no third-party realtime service.
- **Versions** are explicit snapshots (full encoded state + portable Markdown), written on a cadence,
  on meaningful events and on demand. We do not rely on Yjs GC-disabled time travel, which grows without
  bound on long documents.
- **Comment and suggestion anchors** are encoded `Y.RelativePosition`s with a quote fallback.
- **Presence** (avatars, live cursors) uses awareness over the same connection.

Automerge's full-history model is attractive, but the editor binding, anchor and presence stories are
what Vellum leans on daily, and Yjs is ahead on all three.

## Prototype

`packages/core/src/sync` implements the protocol session, snapshot helpers and an in-memory link that
can be disconnected to simulate going offline. `packages/core/test/sync.test.ts` demonstrates:

1. two clients and a relay server converging after **concurrent offline edits** to the same sentence;
2. convergence regardless of the order updates arrive in;
3. restoring an earlier snapshot;
4. an anchor surviving a concurrent insertion before it;
5. presence propagated through awareness.

## Consequences

- Autosave becomes "persist Yjs updates" and cannot clobber concurrent edits by construction.
- Anything not representable as a Yjs operation (e.g. restoring a version) is applied as a normal edit
  on top of current state, so it syncs and can itself be undone or reverted.
- Server storage is append-only binary updates per document, periodically compacted with
  `Y.mergeUpdates`.
