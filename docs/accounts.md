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

## Sharing and presence

Open **Share** in a document to share it with anyone who has an account on the server. Each person gets one of four roles:

| Role    | Can do                                                   |
| ------- | -------------------------------------------------------- |
| View    | Read the document                                        |
| Comment | Read and add comments                                    |
| Suggest | Read and edit, with every change tracked as a suggestion |
| Edit    | Edit directly                                            |

Workspace members (everyone except guests) can always edit the workspace's documents. People you share a document with individually find it under **Shared with me** in the sidebar.

**Share links** carry a role and expire after 1, 7 or 30 days. The link's token is stored hashed and can be turned off at any time. When someone signs in and opens a link, they get its role until the link expires, but never a weaker role than they already had.

**Public links** are for pieces marked Published. The server renders them as plain, read-only HTML at `/p/<token>`. The page runs no scripts, requires no sign-in and tells search engines not to index it. Pending suggestions and comments aren't shown. Unpublishing a piece turns its public link off.

**Presence** runs over the same WebSocket as sync, using Yjs awareness, so no third-party realtime service is involved. The top bar shows who's in the document, and other people's cursors and selections appear with their names.

**Enforcement is on the server.** Viewers can't change anything, and commenters can only change comment threads. The server checks every incoming update against a scratch copy of the document and closes the connection (`4403`) if the update touches anything the role doesn't allow. Suggest access is enforced by the client, which locks the editor into suggesting mode.

## Importing

**Workspace and people → Import** accepts:

| Source                     | How to export                                               | What's kept                                                                                                                   |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Markdown files or a folder | Choose the files or folder                                  | Front matter `title` or the first `# Heading` becomes the title; folders become collections                                   |
| Notion                     | Settings → Export → Markdown & CSV (.zip)                   | Page hierarchy becomes collections, page IDs are removed from names, images are embedded; databases (CSV) are skipped for now |
| Google Docs                | File → Download → Web page (.zip) or Microsoft Word (.docx) | Headings, bold/italic/strikethrough, links (Google redirect links are unwrapped) and images                                   |

Local images of up to 5 MB are embedded in the document. Links between exported pages become plain text.
