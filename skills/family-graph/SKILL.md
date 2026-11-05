---
name: family-graph
description: Install Family Graph, a self-hosted family archive, on this computer or a server, and connect this agent to it over MCP. Use when asked to install, set up, update or connect Family Graph.
---

# Install Family Graph

Ask once: this computer, or a server? For a server you also need its SSH access and a domain pointed at it. Everything below runs on that machine.

1. Docker must be running (`docker info`). If it is not, tell the person how to get it: https://docs.docker.com/get-docker/ . Do not install system software without asking.
2. Install. On this computer:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/dp-arhipov/family-graph/main/install.sh | sh
   ```

   On a server, with automatic HTTPS (ports 80 and 443 open):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/dp-arhipov/family-graph/main/install.sh | sh -s -- --domain family.example.com
   ```

   It is safe to run again. It keeps settings and data in `~/family-graph` and in a Docker volume.
3. Give the person the link it prints. They name the family in the browser, and the app walks them through the rest. Do not fill in that form for them: whoever opens it first becomes the owner.
4. After they have done that, connect this agent:

   ```bash
   cd ~/family-graph && ./family connect
   ```

   If you run elsewhere than the server, ask them to create a key in the app under Settings > Agents and MCP.
5. Check it works: call `get_overview` over MCP. New tools may need a restart of the agent program.

Update: run the install command again. Everything else: `./family help`, and `docs/SELF_HOSTING.md` in the repository.

## Rules

- This is people's family data. Do not copy it anywhere, and do not read `.env` aloud or into logs.
- An agent's key makes edits wait for a person's review. Do not ask for a key that writes directly unless they say so.
- Before anything that can lose data, such as removing the Docker volume, ask first and download a copy: `./family backup`.
