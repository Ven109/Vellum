# Vellum

Vellum is an open-source writing app for people who write long-form: essays, articles, newsletters,
documentation and books. It runs in the browser and as a desktop app (macOS, Windows, Linux), works
offline, and has a writing assistant that uses **your own** AI provider key.

- **Self-hostable.** One `docker compose up` gets you the whole product. Self-hosters get every feature;
  nothing is gated behind a hosted plan.
- **Bring your own key.** The assistant talks to Anthropic, OpenAI, any OpenAI-compatible endpoint or a
  local runtime such as Ollama. There is no hosted inference and no fallback key — you choose the
  provider and you pay it directly.
- **Portable documents.** Documents are stored as Markdown with a small metadata header, so your writing
  is never locked in.
- **Local-first.** Document state is a CRDT, so offline editing, realtime collaboration and version
  history all come from one mechanism.

## Repository layout

| Path              | What lives there                                              |
| ----------------- | ------------------------------------------------------------- |
| `apps/web`        | The web app (React + Vite)                                    |
| `apps/desktop`    | The Electron shell that wraps the web app                     |
| `packages/core`   | Data model, document format and pure domain logic             |
| `packages/editor` | Rich-text schema and editor extensions (ProseMirror / TipTap) |

## Getting started

```sh
corepack enable
pnpm install
pnpm dev        # start the web app
pnpm test       # run the unit tests
pnpm lint       # lint everything
pnpm typecheck  # typecheck every package
```

Node.js 22.13 or newer is required.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Please report security issues privately as described in
[SECURITY.md](SECURITY.md).

## Licence

Vellum is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). We chose the
AGPL so that anyone who runs a modified Vellum as a hosted service must share their changes with its
users — the project stays open even when it is offered as SaaS.
