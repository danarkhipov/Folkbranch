# Self-hosting

## On your own computer

```bash
curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh
```

It needs nothing installed first, on macOS or Linux. The command picks the lightest way that works here:

| What the computer has | What it does | Download | On disk |
|---|---|---|---|
| Node 24 or newer | Uses that Node | 23 MB | about 90 MB |
| No suitable Node | Brings its own, checked against Node's published checksums and kept inside the folder | about 48 MB | about 210 MB |
| Anything, with `--docker` | Runs the Docker image, as on a server | 115 MB | more, with Docker itself |

With Node at hand, `npx folkbranch` runs the same installer, and later `npx folkbranch` opens the app and `npx folkbranch stop` stops it.

Everything goes to `~/folkbranch` (`--dir` for another folder): the app in `app`, your archive in `data`, settings in `.env`, the log in `logs`. Add `--port 8080` for another port: `... | sh -s -- --port 8080`. If the port is taken the command says so, and running it again with `--port` moves the app. The app listens on this computer only.

The first install opens the browser by itself; `--no-open` leaves that out. Without Docker it runs as your own user and keeps itself going through a crash and a restore, but it does not start when the computer does. After a reboot:

```bash
cd ~/folkbranch && ./folkbranch open
```

To remove it, `./folkbranch stop`, then delete the folder. That deletes the archive too, so download a copy first.

A folder stays the kind of install it is, so an update cannot leave your data behind. To move between them, download a full copy in the app, install into another folder and restore it there. Alpine Linux and other systems with no ready build use `--docker`.

**Windows, not proven yet.** In PowerShell: `irm https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.ps1 | iex`. It works the same way, with `.\\folkbranch` for the commands, except `share`. It is checked on a Windows machine only when a release is built, and has not been through one yet. Docker Desktop is the proven way on Windows.

## On a server

Any Linux server you rent or already have, with systemd and 512 MB of memory: Ubuntu 22.04 or newer, Debian 12 or newer, AlmaLinux, Rocky or Red Hat 9, Fedora, or Amazon Linux 2023. Each is checked with a reboot, at that memory. Other Linux with systemd and glibc 2.29 or newer should work. It needs no Docker and no domain:

```bash
curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sudo sh -s -- --server
```

It prints a link to name your family, for example `https://203.0.113.5/setup?code=...`. Open ports 80 and 443 in your hosting panel if it has its own firewall.

What it sets up, all inside `/opt/folkbranch`. Without the `sudo` in front it goes to your own `~/folkbranch`, asks for sudo only for the services, and runs as you:

- The app and [Caddy](https://caddyserver.com), each a service that starts with the server and restarts after a failure. Neither runs as root.
- A certificate from Let's Encrypt that renews by itself. With no domain it is for the server's address and lasts six days at a time.
- Ports 80 and 443 in ufw or firewalld, if one of them is on.

**Your own domain.** Point its DNS at the server, then run the same command with `--domain family.example.com`, now or later. The archive stays, and links made earlier stop working when the address changes.

**Already have nginx or another web server?** The command says so and changes nothing. Add `--no-caddy` with your domain, and proxy that domain to `127.0.0.1:3000`.

**When you create the server.** Most hosting panels have a field called user data or cloud-init. This does the same install on first boot:

```yaml
#cloud-config
runcmd:
  - curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh -s -- --server
```

To get the link afterwards, sign in over SSH and run `sudo /opt/folkbranch/folkbranch open`, or read `/var/log/cloud-init-output.log`.

**With Docker.** On a server that already has it, `--domain family.example.com` runs the image with Caddy next to it, in a 115 MB image. Do not expose the app over plain HTTP: passwords do not exist here, but sign-in links and sessions would travel in the open.

Already have a reverse proxy? Run `./install.sh --port 3000`, set `BETTER_AUTH_URL=https://your.domain` in `.env`, run `docker compose up -d`, and proxy to `127.0.0.1:3000`.

## Railway

The repository is ready for Railway: `.railway/railway.ts` describes one service with a volume at `/data` and a health check. Nothing is needed beyond the [Railway CLI](https://docs.railway.com/cli) and a Hobby plan.

```bash
railway login
railway init --name folkbranch
railway config apply
railway variable set --service folkbranch "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
railway domain --service folkbranch
railway up --service folkbranch
railway logs --service folkbranch
```

The logs print the link that claims the empty archive. Open it and create the owner. The link's code stops working after that.

**What is kept, and where.** The database, photos and agent files live on the volume, so they survive restarts and new deploys. Without a volume the app refuses to start and says so, because a container's own disk is wiped on every deploy; the previous deploy keeps running. Run one replica only: SQLite and the photos live on that one volume.

**Keys.** `BETTER_AUTH_SECRET` signs sessions and encrypts the assistant's provider key in the database. Keep it in Railway's variables, not in the volume, so that a copy of the volume alone cannot decrypt the key. Changing it signs everyone out and asks for the provider key again; no family data is lost. Without it, the app generates one on the volume. Sign-in has no passwords: the first person uses the claim link, relatives use one-time invitations.

**Your own domain.** Add it in Railway, then set `BETTER_AUTH_URL=https://your.domain` and redeploy. The old Railway address keeps working. Google or Yandex sign-in also need `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, with the callbacks `/api/auth/callback/google` and `/api/auth/oauth2/callback/yandex` at your address.

**Locked out or need a copy.** `railway ssh --service folkbranch`, then `node folkbranch.mjs login-link` or `node folkbranch.mjs backup`. Backups land in `/data/backups`, on the same volume, so also take one off the server or turn on volume backups in Railway.

**Memory.** With a family of 1000 and 20 people looking at it, the app stays near 130 MB, and 256 MB is enough for a family of this size including uploads and an import. It holds one parsed copy of the family, rebuilt only after a change. The image limits the JavaScript heap to 256 MB through `NODE_OPTIONS`; an archive with very many people or very large uploads may need more.

## Other platforms

Any platform that runs a Dockerfile and gives you a persistent `/data` works the same way; set `BETTER_AUTH_URL` there. The container starts as root only to hand the volume to the `node` user, then runs the app as `node`.

## The first person

An empty instance can be claimed only with a code, so a stranger who finds it first cannot take it. `install.sh` prints a link with the code. Otherwise it is in the logs (`docker compose logs folkbranch`) and in `setup-code` in the data folder. After the first person signs up, the code stops mattering.

## Asking for a story

**Settings → Users and access → Ask for a story** makes a link for one person. Whoever has it can only record: they see no one else in the family, and what they send waits for your review. Recording in the browser needs HTTPS, so on a plain address the page offers to pick a sound file instead, such as a voice memo from the phone.

## A link from your own computer

A link made at home opens only at home. `./folkbranch share` gives the app an address on the internet through a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), with no account, and links you make after that lead there, over HTTPS, so recording in the browser works too. It asks first, because it opens a way in from the whole internet: the archive stays behind its sign-in, but Cloudflare carries the traffic. The address changes each time and stops working with `./folkbranch share stop` or when the computer sleeps. For something lasting, use a server.

## Commands

| Command | What it does |
|---|---|
| `./folkbranch open` | Open the app in the browser, signed in as the owner, starting it first if needed |
| `./folkbranch share`, `share stop` | Give the app an address on the internet for a while, so a relative's link opens |
| `./folkbranch start`, `stop`, `restart`, `status`, `logs` | Without Docker: run the app and read its log |
| `./folkbranch connect` | Connect Claude Code or Codex over MCP |
| `./folkbranch token create --name NAME` | Connect an agent, see [AGENTS.md](AGENTS.md) |
| `./folkbranch token list`, `./folkbranch token revoke ID` | See and cut off tokens |
| `./folkbranch login-link` | One-time sign-in link for the owner, for when you are locked out. With `--now` it signs in on opening, without a button: use it only on this computer, not in a message |
| `./folkbranch backup` | Consistent copy of the database and photos, safe while running |
| `./folkbranch doctor` | Where the data is and what is in it |

## Backups

**From the app.** Settings → Import and export → Download a full copy: one file with the database, photos and files, and a checksum for each. It leaves out sign-in sessions and can be restored on a clean install from the setup screen, or over an archive from the same place in settings. The previous archive stays in `backups/before-restore` on the volume. An assistant key set in the app has to be entered again unless the server keeps the same secret.

Restoring restarts the process, so something must start it again: the install without Docker, Docker Compose and Railway all do. Under plain `pnpm dev` start it by hand.

**From the command line.**

`./folkbranch backup` writes to `backups/` inside the data folder, or the data volume under Docker. To take a copy off a Docker server:

```bash
docker compose cp family:/data/backups ./backups
```

Restore by stopping the app and putting `family.db` and `media/` back into the data folder or volume. Also keep `.env`, or at least `BETTER_AUTH_SECRET`; losing it signs everyone out but loses no data.

## Updating

Run the install command again, in any kind of install. From a clone with Docker: `git pull && ./install.sh`.

Settings and data are kept, and the database migrates on start. Take a backup first. If an update without Docker fails to start, the previous version stays next to it in `app.old`.

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

All of them are optional and explained in [.env.example](../.env.example). Change `.env`, then run `./folkbranch restart`, or `docker compose up -d` under Docker.

## The copy before an update

An update changes the database by itself at start if the new version has migrations. Before that, the server puts a copy of the database in `backups/before-migration-<number>/family.db` inside the data folder and keeps the last five. Photos are not included: migrations do not touch them. If the copy cannot be made, for example because the disk is full, the database stays as it is, and the server does not start and writes the reason to its log.

To go back to the copy: stop the server, replace `family.db` with the file from the copy, delete `family.db-wal` and `family.db-shm`, and start the previous version of the app. With the new version the migration simply applies again. Changes made after the update are lost.
