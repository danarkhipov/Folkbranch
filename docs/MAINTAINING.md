# Maintaining the repository

Some settings live on GitHub and cannot be set by files in this repository. **None of the settings below is on until the maintainer turns it on.** Check each one in the repository settings before relying on it. The menu names can change; if a path below does not match, look for the setting by name.

Commands marked "run by the maintainer" are examples for the repository owner. Agents and contributors do not run them.

## Maintainer settings

| Setting | Why | Where to turn it on |
|---|---|---|
| Branch ruleset for `main` and `develop`: require a pull request | No change reaches a protected branch without review | Settings > Rules > Rulesets |
| One approving review from the code owners; dismiss stale approvals | One reviewer is enough, and an old approval does not survive a new push | Same ruleset: "Require a pull request before merging" |
| Required status checks (see the list below); branch up to date before merge | A merge needs every check to pass on the current code | Same ruleset: "Require status checks to pass" |
| Block force pushes and branch deletion | Protected history cannot be rewritten or removed | Same ruleset |
| Squash merge only | Each pull request becomes one commit, titled with its PR title | Settings > General > Pull Requests |
| Tag ruleset for `v*`; only the maintainer creates tags | Only a version tag starts a release | Settings > Rules > Rulesets, target "Tag" |
| Secret scanning and push protection | Stops tokens and keys from entering the history | Settings > Advanced Security (shown as Code security) |
| Dependabot alerts and Dependabot security updates | Vulnerable dependencies are reported and updated | Settings > Advanced Security (shown as Code security) |
| Private vulnerability reporting | Reports arrive privately, as `SECURITY.md` asks | Settings > Advanced Security (shown as Code security) |
| Code scanning default setup: off | The CodeQL workflow in the repository is the one that runs | Settings > Advanced Security (shown as Code security) (shown as Code security), Code scanning |
| Default workflow token: read-only | Workflows get `contents: read` unless they ask for more | Settings > Actions > General, Workflow permissions |
| Approval for first-time contributors and for all outside collaborators' workflow runs | Workflows from forks do not run unchecked | Settings > Actions > General, fork pull request workflows |
| Require actions to be pinned to a full commit SHA | A third-party action cannot be changed under a tag | Settings > Actions > General, policies |
| Two-factor authentication for every maintainer | Protects the accounts that can merge, tag and publish | Account security settings |

Releases are made only from tags, as `docs/RELEASING.md` describes.

## Required status checks

The `main` and `develop` rulesets require these checks. Each check guards the part of the project listed next to it.

| Check | Guards |
|---|---|
| `test` | Types and ESLint, unit tests (vitest), `pnpm audit --audit-level high`, import cycles |
| `ui` | Browser checks on a production build. Uploads the `ui-screenshots` artifact, kept 14 days |
| `authorship` | No commit names an AI assistant as author or co-author |
| `dependency-review` | No added dependency with a known vulnerability; no SSPL or BUSL licence |
| `workflows` | Workflow files pass actionlint |
| `secrets` | gitleaks over the branch history; no archive, database or GEDCOM file committed outside `tests/`, `docs/`, `public/` and `drizzle/` |
| `local-install` | Install without Docker; update from the last release on the same data; concurrency and crash scenarios |
| `server-install` | Install with `--server` on a Linux machine like the ones people rent, and it survives a reboot |
| `docker` | Image builds and answers; Trivy finds no critical vulnerability that has a fix |
| `analyze` (workflow CodeQL) | Code scanning |

## Reviewing a pull request

1. Open the pull request's `ui` run and download the `ui-screenshots` artifact. It is kept for 14 days, so review within that time.
2. Read the before and after screenshots (laptop and phone) in the pull request, and compare them with the artifact.
3. Read the Speed section. For a screen with many items, the author should say how it was checked on a large family.
4. Read the `CHANGELOG.md` line under **Unreleased**. It should describe what people can do now, not which file changed.
5. Find the test that fails without the fix. The pull request says how the author checked it. If it is unclear, revert the fix on a local branch and run the test.
6. Check that no real family data appears in code, tests, screenshots or issues.
7. Squash-merge into `develop`. The PR title becomes the commit message, so it must follow Conventional Commits.

## Updating pinned actions

Third-party actions are pinned to a full commit SHA, with the version in a comment next to it. Dependabot proposes updates for actions, npm and Docker once a month, into `develop`.

For each Dependabot pull request that updates an action:

1. Check that the version comment next to the SHA names the new version.
2. Read the release notes for that version. Look for breaking changes, new permissions and changed inputs.
3. Check that the SHA is the commit of the release tag named in the comment. The tag page on the action's repository shows it.
4. Let the checks run. Merge on green, like any other pull request.

Run by the maintainer, to apply the repository-level settings from the command line (the other settings above are only in the web interface):

```bash
# Vulnerability alerts on
gh api -X PUT repos/OWNER/REPO/vulnerability-alerts

# Secret scanning and push protection on
gh api -X PATCH repos/OWNER/REPO \
  -F security_and_analysis[secret_scanning][status]=enabled \
  -F security_and_analysis[secret_scanning_push_protection][status]=enabled

# Private vulnerability reporting on
gh api -X PUT repos/OWNER/REPO/private-vulnerability-reporting

# Classic branch protection on develop (the rulesets above are preferred; this is a fallback)
gh api -X PUT repos/OWNER/REPO/branches/develop/protection --input protection.json
```

Replace `OWNER` and `REPO` with the repository's owner and name. `protection.json` holds the required checks and the review rule in the form the branch protection endpoint expects. Check the result in the web interface before relying on it.

## Audit exceptions

`pnpm.auditConfig.ignoreGhsas` in `package.json` lists advisories that `pnpm audit` skips. Keep it empty when possible. An entry needs a reason here and a removal condition.

- `GHSA-fc5q-39xc-vjpf` (picomatch ReDoS, 17 Nov 2026): no patched version exists. The package is reached only through `better-auth` → `vitest` → `vite`, test tooling that the running app never loads. Remove the entry when picomatch publishes a fix above 4.0.7 and the lockfile takes it.
