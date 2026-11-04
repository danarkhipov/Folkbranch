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
