---
name: folkbranch
description: Install Folkbranch, a self-hosted family archive, on this computer or a server, open it, and connect this agent to it over MCP. Use when asked to install, set up, update, open or connect Folkbranch.
---

# Install Folkbranch

Ask once: this computer, or a server? For a server you also need its SSH access and a domain pointed at it. Everything below runs on that machine.

1. Install. On this computer it needs nothing else on macOS or Linux, it brings its own Node if there is none:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh
   ```

2. On a server, or if the person asks for Docker, use Docker with `--docker`, and with `--domain` for automatic HTTPS (ports 80 and 443 open). Windows needs Docker too. Docker must be running (`docker info`). If it is not, tell the person how to get it: https://docs.docker.com/get-docker/ . Do not install system software without asking.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh -s -- --domain family.example.com
   ```

   It is safe to run again. It keeps settings and data in `~/folkbranch`, and under Docker in a Docker volume. If it says the port is taken, run it again with `--port 8080`.
3. On this computer the browser opens by itself. Otherwise give the person the link it prints. They name the family in the browser, and the app walks them through the rest. Do not fill in that form for them: whoever opens it first becomes the owner.
4. After they have done that, connect this agent:

   ```bash
   cd ~/folkbranch && ./folkbranch connect
   ```

   If you run elsewhere than the server, ask them to create a key in the app under Settings > Agents and MCP.
5. Check it works: call `get_overview` over MCP. New tools may need a restart of the agent program.

Open it later, signed in and started if it was stopped: `cd ~/folkbranch && ./folkbranch open`. Never paste that link anywhere: it signs in as the owner.

On a server, use `... | sudo sh -s -- --server`, or over SSH when they name a machine: it needs no Docker, gets HTTPS by itself, and starts with the server. Add `--domain` if they have one, and give them the printed link. Ask them to open ports 80 and 443 in the hosting panel if HTTPS is not ready. Creating or paying for a server is their decision, not yours.

Update: run the install command again. Everything else: `./folkbranch help`, and `docs/SELF_HOSTING.md` in the repository.

## The first minutes

Once they have named the family and this agent is connected, ask what they already know: names, years, who is whose. Add it with `import_text` so they watch the chart grow in the browser, and it waits for their review. Do not guess what they did not say.

## A research case

If the ex-ussr-kinship-research skill made a case folder, bring it in with the `import_kinship_case` tool: pass `case_id` from `case-intake.yaml` as `caseId` and the text of `person-register.csv`, `relationship-register.csv`, `claims-register.csv` and `artifact-register.csv`, nothing else from the folder. The person can also pick the folder under Settings > Files. Candidates stay separate cards, unproved relations stay notes, and edits wait for review. Importing again adds only what is new. Do not merge a new card with an old one by name: that is the person's decision.

## Sharing from this computer

Links made on this computer open only here. `./folkbranch share` gives the app an address on the internet through Cloudflare. Never run it, or pass `--yes`, unless the person has said so after hearing that: it opens a way in from the whole internet until `./folkbranch share stop`.

## Rules

- This is people's family data. Do not copy it anywhere, and do not read `.env` aloud or into logs.
- An agent's key makes edits wait for a person's review. Do not ask for a key that writes directly unless they say so.
- Before anything that can lose data, such as removing the install folder or the Docker volume, ask first and download a copy: `./folkbranch backup`.
- Without Docker the app does not start with the computer. After a reboot: `cd ~/folkbranch && ./folkbranch start`.
