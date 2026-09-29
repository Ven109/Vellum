# Self-hosting Vellum

A self-hosted Vellum has every feature. Nothing is held back for a hosted plan. The Docker Compose setup runs two containers:

| Service   | What it runs                                                                                                  | Data                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `vellum`  | The sync, accounts and sharing server, with the web app built in. Its database is embedded SQLite (WAL mode). | `vellum-data` volume: `vellum.db` and the document updates |
| `storage` | S3-compatible object storage for images ([RustFS](https://github.com/rustfs/rustfs))                          | `storage-data` volume                                      |

You don't run or pay for any AI service. Each writer connects their own provider key, and requests go straight from their device to that provider (see [ai-providers.md](ai-providers.md)).

## Quick start

You need Docker with the Compose plugin.

```sh
git clone https://github.com/Ven109/Vellum.git && cd Vellum
./scripts/selfhost.sh
```

On first run the script copies `.env.example` to `.env`, fills in random storage keys, and starts the stack. It then waits until Vellum is healthy. Open the address it prints; the first visit asks you to create the administrator account. Sign-up is invite-only until you change it (see [accounts.md](accounts.md)).

Doing it by hand:

```sh
cp .env.example .env    # set STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY
docker compose up -d
```

## Configuration

Every setting lives in `.env`, and `.env.example` documents each one. The main ones:

| Variable                                         | Default                 | Purpose                                                                                                                                      |
| ------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VELLUM_PUBLIC_URL`                              | `http://localhost:8787` | The address people use. It appears in invite, share and reset links and OAuth callbacks. With `https://`, session cookies are marked Secure. |
| `VELLUM_PORT`                                    | `8787`                  | Port on the host                                                                                                                             |
| `VELLUM_TAG`                                     | `latest`                | Image tag to run, for example `v1.2.0`                                                                                                       |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`       | — (required)            | Credentials shared by Vellum and the storage service                                                                                         |
| `VELLUM_S3_BUCKET`                               | `vellum`                | Bucket for uploads. Vellum creates it if it's missing.                                                                                       |
| `VELLUM_SMTP_URL`, `VELLUM_MAIL_FROM`            | —                       | Email for invites and password resets. Without them, links are written to the log.                                                           |
| `VELLUM_OAUTH_GITHUB_*`, `VELLUM_OAUTH_GOOGLE_*` | —                       | Optional sign-in with GitHub or Google                                                                                                       |
| `LOG_LEVEL`                                      | `info`                  | Server log level                                                                                                                             |

### Using other object storage

Any S3-compatible service works, including AWS S3, Cloudflare R2, Garage and SeaweedFS. Set these on the `vellum` service and remove the `storage` service:

- `VELLUM_S3_ENDPOINT`
- `VELLUM_S3_REGION`
- `VELLUM_S3_BUCKET`
- `VELLUM_S3_ACCESS_KEY` and `VELLUM_S3_SECRET_KEY`

Requests use path-style URLs and Signature Version 4.

If `VELLUM_S3_ENDPOINT` isn't set at all, for example when running the server without Compose, uploads are stored under `<data dir>/uploads`.

## TLS and reverse proxies

Put Vellum behind a reverse proxy that terminates TLS, and set `VELLUM_PUBLIC_URL` to the `https://` address. Real-time sync uses WebSockets on `/sync/`, so the proxy must pass `Upgrade` and `Connection` headers through. With Caddy this is automatic:

```
vellum.example.com {
  reverse_proxy localhost:8787
}
```

With nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  client_max_body_size 12m;
}
```

## Backups

Everything worth keeping is in the two volumes. For a consistent copy, stop Vellum briefly:

```sh
docker compose stop vellum
docker run --rm -v vellum_vellum-data:/data -v "$PWD":/backup alpine tar czf /backup/vellum-data.tgz -C /data .
docker run --rm -v vellum_storage-data:/data -v "$PWD":/backup alpine tar czf /backup/vellum-storage.tgz -C /data .
docker compose start vellum
```

To restore, extract the archives into fresh volumes with the same names before starting the stack.

## Upgrading

```sh
git pull
./scripts/selfhost.sh
```

This pulls the newest image, or builds it from your checkout with `--build`, and restarts. Database migrations run automatically on start. Pin a version with `VELLUM_TAG=v1.2.0` if you'd rather upgrade on your own schedule.

## Building the image yourself

```sh
docker build -t vellum .
```

If you build behind a TLS-inspecting proxy, pass its CA to the dependency install with `--secret id=ca_bundle,src=/path/to/ca.pem`.
