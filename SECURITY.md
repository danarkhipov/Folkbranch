# Security

Family archives hold private data about real people, so please report vulnerabilities privately: use **Security → Report a vulnerability** on the repository's GitHub page, not a public issue. Do not include real personal data in a report.

Only the latest version is supported.

## What the app promises

- Readers and reader tokens never receive living people, in any response.
- Tokens and invitations are stored only as hashes. Tokens can expire and be revoked.
- Every write is recorded in history under the name of whoever made it.
- Links to remote images cannot reach private network addresses.

## What is up to you

- Run it behind HTTPS on any public address. `./install.sh --domain` does this.
- Keep `.env` and the data volume private, and take backups. Data is not encrypted at rest.
- A person marked as dead, or with a birth year too old to be alive, is treated as not living. Check imported data.

## The assistant and prompt injection

Text in pages, sources and attached files can address the model, and no prompt can stop that for certain. So the app limits what a fooled model can do: nothing on a page loads from another site (Content-Security-Policy), any tool call containing an outside address always asks the person and shows the address, the chat does not render links or pictures from the model, invitation links never reach the model, and role checks run on the server whatever the model says. What the assistant reads, and what is attached in chat, goes to the chosen AI provider.
