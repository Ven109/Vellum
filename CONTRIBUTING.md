# Contributing to Vellum

Thanks for helping build Vellum. This guide covers how to get set up, how we work and what we expect
from a pull request.

## Development setup

1. Install Node.js 22.13+ and enable Corepack (`corepack enable`) so the pinned pnpm version is used.
2. `pnpm install`
3. `pnpm dev` starts the web app. See the package READMEs for the server and desktop app.

## Before you open a pull request

Run the same checks CI runs:

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

- Keep pull requests focused: one change per PR.
- Add or update tests for behaviour you change. Pure logic belongs in `packages/core` with unit tests.
- Update documentation when you change user-facing behaviour or configuration.
- Use clear commit messages in the imperative mood ("Add outline panel", not "Added outline panel").

## Issues

- Search existing issues before opening a new one.
- Use the bug report or feature request template.
- For security issues, **do not open a public issue** — follow [SECURITY.md](SECURITY.md).

## Design principles

- **Nothing silent.** The assistant proposes; the writer decides. Edits by the assistant are always
  visible and attributed in history.
- **Your key, your provider.** Never add a hosted inference fallback or send user keys anywhere except the
  provider the user chose.
- **Portable by default.** Anything we store should be exportable to plain files.
- **Self-hosters are first-class.** No feature may depend on a third-party service that a self-hoster
  cannot replace or disable.

## Licence of contributions

By contributing you agree that your contributions are licensed under the project licence,
AGPL-3.0-or-later.
