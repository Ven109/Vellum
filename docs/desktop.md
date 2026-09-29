# Desktop app

The desktop app (`apps/desktop`) is an Electron shell around the same web app. It works fully offline; no server is required.

## Security model

- The web app is served from a private origin, `app://vellum`, by a custom protocol handler. Every response carries a strict Content-Security-Policy: scripts only from the app itself, and network access only to HTTPS, WebSockets and localhost (for AI providers you choose and a Vellum server).
- The window runs with `contextIsolation`, `sandbox` and no Node integration, and `app.enableSandbox()` sandboxes every renderer. The page has no `require` and no `process`.
- The preload script exposes one small bridge, `window.vellumDesktop`:
  - `platform`
  - `secrets.get` / `set` / `delete` / `isEncryptionAvailable`

  The main process checks that each call comes from `app://vellum` and validates its arguments.

- Provider API keys are encrypted with the OS keychain through Electron `safeStorage`: macOS Keychain, Windows DPAPI, or libsecret/kwallet on Linux. On Linux without a keyring, Electron would fall back to a hard-coded key. The bridge reports "not available" in that case, and the app uses its own encrypted browser store instead.
- The app never navigates away from `app://vellum`. Web links open in the default browser, and pop-ups and `<webview>` are blocked. All permission requests (camera, microphone, notifications and so on) are denied unless a feature asks for one on purpose.

## Offline first, and syncing with a server

On its own, the desktop app is fully local. Documents, their history, the search index, writing sessions and settings all live on the device, so nothing needs a network.

To sync with a Vellum server, open **Settings → Profile → Sync with a Vellum server** and sign in:

- The app talks to the server from its own origin, so it uses a **bearer token** rather than a cookie. The server returns a token to clients that ask with `x-vellum-token: 1`, and allows cross-origin requests only from `app://vellum` and from `VELLUM_CORS_ORIGINS`. Credentials are never sent cross-origin. The sync socket takes the token as `?access_token=`, which is redacted from logs.
- **Background sync** keeps every document in your workspaces, and those shared with you, up to date in both directions. It runs at sign-in, when the connection comes back, and every 15 minutes. Offline edits to documents that aren't open go up, and changes made elsewhere come down. Documents created on other devices appear in the library.
- **Conflicts never ask you anything.** The CRDT merges concurrent edits. If edits from elsewhere are merged into offline work, what this device had just before the merge is saved as a named version, "Your offline edits, before merging", so nothing written offline can be lost.

To go back to working only on this device, choose **Disconnect**.

## Building

```sh
pnpm --filter @vellum/desktop start      # build and run
pnpm --filter @vellum/desktop package    # unsigned installers for this OS in apps/desktop/release
pnpm --filter @vellum/desktop budget     # check size and cold-start budgets
pnpm --filter @vellum/desktop exec playwright test   # end-to-end tests (use xvfb-run on headless Linux)
```

Packages are built with electron-builder:

| OS      | Installers                           | Signing                                     |
| ------- | ------------------------------------ | ------------------------------------------- |
| macOS   | `.dmg`, `.zip`                       | Developer ID, hardened runtime, notarised   |
| Windows | NSIS `.exe`                          | Authenticode                                |
| Linux   | AppImage, `.deb`; Flatpak on release | Not signed; verify against `SHA256SUMS.txt` |

Signing only happens in the release workflow. See [releasing.md](releasing.md).

## Budgets

The limits are agreed in `apps/desktop/budget.json` and checked in CI on macOS, Windows and Linux after packaging:

| Budget                                                                | Limit   | Measured on Linux x64 at the time of writing |
| --------------------------------------------------------------------- | ------- | -------------------------------------------- |
| Each installer                                                        | 140 MB  | AppImage 118 MB, `.deb` 93 MB                |
| Unpacked app                                                          | 350 MB  | 277 MB                                       |
| Cold start (process launch to the app's first page load; median of 3) | 3000 ms | ~240 ms                                      |

Raise a budget only on purpose, in the same pull request that needs it.
