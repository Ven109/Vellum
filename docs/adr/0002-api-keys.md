# ADR 0002 — Where provider keys live and how requests reach the provider

- **Status:** Accepted
- **Work item:** VEL-17 (secure key storage)

## Decision

**Requests go directly from the user's device to the provider they chose. There is no pass-through.**
The Vellum server — hosted or self-hosted — never receives, stores, proxies or logs a provider key or an
assistant request. Because nothing passes through us, there is nothing for us to retain.

### Desktop

Keys are stored in the operating system keychain through Electron's `safeStorage` (macOS Keychain,
Windows DPAPI / Credential Manager, libsecret on Linux). The renderer reaches it only through a narrow
preload bridge (`window.vellumDesktop.secrets`) under context isolation. Keys are never written to a
plain config file. If `safeStorage` reports encryption is unavailable (e.g. no keyring on Linux), the
app refuses to save the key and says why rather than falling back to plaintext.

### Web

Keys are encrypted at rest in the browser (IndexedDB) with AES-GCM under a **per-user, per-device
wrapping key generated as non-extractable** by WebCrypto. Script can ask the browser to decrypt with it,
but can never read its raw bytes, so copying the browser profile's files does not reveal keys.

### In the UI

- After save, the key is never shown again — only its last four characters and when it was saved.
- Keys are read by the provider adapters at request time (`withKey`) and never stored in app state,
  logged, or included in error messages (`redact()` masks any key that a provider echoes back).
- **Rotate:** saving a new key replaces the old one. **Revoke:** removing a provider deletes its key
  from this device. Users should also revoke the key in the provider's console if it leaked.

## Why not a server pass-through?

A pass-through would let us work around providers that block browser requests (CORS), but it would put
every user's key and every draft on our servers, which is exactly what bring-your-own-key is meant to
avoid, and it would make self-hosters responsible for securing other people's keys. All four supported
backends accept direct client calls (Anthropic with `anthropic-dangerous-direct-browser-access`; local
runtimes after allowing the app's origin, e.g. `OLLAMA_ORIGINS`). If a provider ever requires a
pass-through we will revisit this ADR, and any pass-through must be stateless: no request or response
bodies stored, keys held only in memory for the life of the request, and logs redacted.

## Consequences

- Keys are per device: a user who signs in on a second device enters their key again. This is
  deliberate.
- Clearing site data in the browser removes the stored key.
