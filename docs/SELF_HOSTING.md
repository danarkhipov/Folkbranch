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

## Railway and similar platforms

The repository includes `railway.json`. Attach a volume at `/data`, set `RAILWAY_RUN_UID=0` so the app can write to it, and read the claim link from the deploy logs. The address is picked up from `RAILWAY_PUBLIC_DOMAIN`. Any platform that runs a Dockerfile and gives you a persistent `/data` works the same way; set `BETTER_AUTH_URL` there.

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
