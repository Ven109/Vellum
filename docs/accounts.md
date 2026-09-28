# Accounts, workspaces and importing

Vellum runs in two modes:

- **Local only**: no server. There's a single local user and everything stays on the device.
- **With a server**: people sign in, documents sync between devices, and workspaces can be shared.

## First run

On a fresh server, the web app opens **Set up Vellum**. That form creates the administrator account and the first workspace. Setup only works once. After that, `/api/setup` returns `409`.

Public sign-up is **off** by default, so the server is invite-only. The admin can turn it on under **Workspace and people → Server**, or during setup.

## Signing in

- **Email and password.** Passwords are hashed with scrypt and must be at least 10 characters. Sessions are `httpOnly`, `SameSite=Lax` cookies that last 30 days.
- **OAuth.** Set these variables to enable a provider. The callback URL is `${VELLUM_PUBLIC_URL}/api/auth/oauth/<provider>/callback`.
  - GitHub: `VELLUM_OAUTH_GITHUB_ID` and `VELLUM_OAUTH_GITHUB_SECRET`
  - Google: `VELLUM_OAUTH_GOOGLE_ID` and `VELLUM_OAUTH_GOOGLE_SECRET`

  An OAuth sign-in joins an existing account that has the same verified email address. It only creates a new account when sign-up is open.

- **Password reset.** Reset links are one-time and expire after one hour. Using one signs the account out everywhere else. The server gives the same answer whether or not the email has an account.
- **Email.** Set `VELLUM_SMTP_URL` (for example `smtps://user:pass@smtp.example.com`) and optionally `VELLUM_MAIL_FROM`. Without SMTP, reset and invite emails are written to the server log instead.

The credential endpoints are rate-limited. Every state-changing API call must send a JSON body, which blocks cross-site form posts.

## Workspaces and roles

Every account has at least one workspace. Owners and admins can invite people by email as an admin, member or guest. Each invite link works once and expires after 7 days. Only owners can change roles, and a workspace always keeps at least one owner.

A document syncs only within its server workspace. The sync socket (`/sync/:docId?ws=<workspace>`) needs a session and membership in that workspace. A new document is registered to the workspace it is first synced under. Guests can't create documents.

Workspaces created while local-only stay on the device and don't sync.

## Importing

**Workspace and people → Import** accepts:

| Source                     | How to export                                               | What's kept                                                                                                                   |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Markdown files or a folder | Choose the files or folder                                  | Front matter `title` or the first `# Heading` becomes the title; folders become collections                                   |
| Notion                     | Settings → Export → Markdown & CSV (.zip)                   | Page hierarchy becomes collections, page IDs are removed from names, images are embedded; databases (CSV) are skipped for now |
| Google Docs                | File → Download → Web page (.zip) or Microsoft Word (.docx) | Headings, bold/italic/strikethrough, links (Google redirect links are unwrapped) and images                                   |

Local images of up to 5 MB are embedded in the document. Links between exported pages become plain text.
