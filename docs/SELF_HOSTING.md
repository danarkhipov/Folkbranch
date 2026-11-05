# Self-hosting

## On your own computer

```bash
./install.sh
```

Add `--port 8080` for another port. The app listens on this computer only.

## On a server with a domain

Point the domain's DNS at the server, open ports 80 and 443, then:

```bash
./install.sh --domain family.example.com
```

Caddy starts next to the app and obtains the certificate by itself. Do not expose the app over plain HTTP: passwords do not exist here, but sign-in links and sessions would travel in the open.

Already have a reverse proxy? Run `./install.sh --port 3000`, set `BETTER_AUTH_URL=https://your.domain` in `.env`, run `docker compose up -d`, and proxy to `127.0.0.1:3000`.

## Railway

The repository is ready for Railway: `.railway/railway.ts` describes one service with a volume at `/data` and a health check. Nothing is needed beyond the [Railway CLI](https://docs.railway.com/cli) and a Hobby plan.

```bash
railway login
railway init --name family-archive
railway config apply
railway variable set --service family "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
railway domain --service family
railway up --service family
railway logs --service family
```

The logs print the link that claims the empty archive. Open it and create the owner. The link's code stops working after that.

**What is kept, and where.** The database, photos and agent files live on the volume, so they survive restarts and new deploys. Without a volume the app refuses to start and says so, because a container's own disk is wiped on every deploy; the previous deploy keeps running. Run one replica only: SQLite and the photos live on that one volume.

**Keys.** `BETTER_AUTH_SECRET` signs sessions and encrypts the assistant's provider key in the database. Keep it in Railway's variables, not in the volume, so that a copy of the volume alone cannot decrypt the key. Changing it signs everyone out and asks for the provider key again; no family data is lost. Without it, the app generates one on the volume. Sign-in has no passwords: the first person uses the claim link, relatives use one-time invitations.

**Your own domain.** Add it in Railway, then set `BETTER_AUTH_URL=https://your.domain` and redeploy. The old Railway address keeps working. Google or Yandex sign-in also need `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, with the callbacks `/api/auth/callback/google` and `/api/auth/oauth2/callback/yandex` at your address.

**Locked out or need a copy.** `railway ssh --service family`, then `node family.mjs login-link` or `node family.mjs backup`. Backups land in `/data/backups`, on the same volume, so also take one off the server or turn on volume backups in Railway.

**Memory.** With a family of 1000 and 20 people looking at it, the app stays near 130 MB, and 256 MB is enough for a family of this size including uploads and an import. It holds one parsed copy of the family, rebuilt only after a change. The image limits the JavaScript heap to 256 MB through `NODE_OPTIONS`; an archive with very many people or very large uploads may need more.

## Other platforms

Any platform that runs a Dockerfile and gives you a persistent `/data` works the same way; set `BETTER_AUTH_URL` there. The container starts as root only to hand the volume to the `node` user, then runs the app as `node`.

## The first person

An empty instance can be claimed only with a code, so a stranger who finds it first cannot take it. `install.sh` prints a link with the code. Otherwise it is in the logs (`docker compose logs family`) and in `setup-code` in the data folder. After the first person signs up, the code stops mattering.

## Commands

| Command | What it does |
|---|---|
| `./family token create --name NAME` | Connect an agent, see [AGENTS.md](AGENTS.md) |
| `./family token list`, `./family token revoke ID` | See and cut off tokens |
| `./family login-link` | One-time sign-in link for the owner, for when you are locked out |
| `./family backup` | Consistent copy of the database and photos, safe while running |
| `./family doctor` | Where the data is and what is in it |

## Backups

**From the app.** Settings → Files → Download a full copy: one file with the database, photos and files, and a checksum for each. It leaves out sign-in sessions and can be restored on a clean install from the setup screen, or over an archive from the same place in settings. The previous archive stays in `backups/before-restore` on the volume. An assistant key set in the app has to be entered again unless the server keeps the same secret.

Restoring restarts the process, so something must start it again: Docker Compose and Railway do. Under plain `pnpm dev` start it by hand.

**From the command line.**

`./family backup` writes to `backups/` inside the data volume. To take a copy off the server:

```bash
docker compose cp family:/data/backups ./backups
```

Restore by stopping the app and putting `family.db` and `media/` back into the volume. Also keep `.env`, or at least `BETTER_AUTH_SECRET`; losing it signs everyone out but loses no data.

## Updating

```bash
git pull && ./install.sh
```

Settings and data are kept, and the database migrates on start. Take a backup first.

## Limits

Measured in Chrome on a desktop:

| People | Chart ready | Panning | Click to open |
|---|---|---|---|
| 100 | 0.4 s | smooth | under 0.1 s |
| 500 | 0.9 s | smooth | 0.1 s |
| 2000 | 4 s | mostly smooth | 0.5 s |

Beyond a few thousand people, the first drawing takes tens of seconds. Files can be up to 40 MB. Allow about 1 GB of memory for batches of large photos. Answers are compressed only by a proxy in front, as with `--domain`.

Without internet the app and its data need none, only face detection in photos downloads its model on first use. Open tabs keep the chart on screen and hold typed text until the server is back, but a new tab cannot open without reaching the server.

## Settings

All of them are optional and explained in [.env.example](../.env.example). Change `.env`, then run `docker compose up -d`.
