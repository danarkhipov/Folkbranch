---
name: folkbranch
description: Install Folkbranch, a self-hosted family archive, on this computer or a server, and connect this agent to it over MCP. Use when asked to install, set up, update or connect Folkbranch.
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
3. Give the person the link it prints. They name the family in the browser, and the app walks them through the rest. Do not fill in that form for them: whoever opens it first becomes the owner.
4. After they have done that, connect this agent:

   ```bash
   cd ~/folkbranch && ./folkbranch connect
   ```

   If you run elsewhere than the server, ask them to create a key in the app under Settings > Agents and MCP.
5. Check it works: call `get_overview` over MCP. New tools may need a restart of the agent program.

Update: run the install command again. Everything else: `./folkbranch help`, and `docs/SELF_HOSTING.md` in the repository.

## Rules

- This is people's family data. Do not copy it anywhere, and do not read `.env` aloud or into logs.
- An agent's key makes edits wait for a person's review. Do not ask for a key that writes directly unless they say so.
- Before anything that can lose data, such as removing the install folder or the Docker volume, ask first and download a copy: `./folkbranch backup`.
- Without Docker the app does not start with the computer. After a reboot: `cd ~/folkbranch && ./folkbranch start`.
