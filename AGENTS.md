# Agent Instructions

> ## ✅ ACTIVE — this is the only CLI for Liskov
>
> `proof-cli-liskov` is the **sole, actively-maintained CLI implementation for
> Liskov**. There is no Rust CLI and no other CLI. It is **TypeScript but not
> legacy**; language does not determine repository lifecycle. Normal Liskov CLI
> product work belongs here. See the workspace constitution `../../AGENTS.md`.

This public npm package owns the Slipway plugin for the root `proof` CLI.

- Treat the package name, public visibility and npm trusted-publisher identity
  as release contracts. Change them only deliberately and in sync with the
  release workflow and npmjs configuration.
- User-facing `proof slipway ...` work belongs here as native oclif plugin
  behavior. Do not add legacy non-oclif adapters as proof command
  implementation paths.
- Keep builder-facing login separate from private operator recovery:
  `proof slipway login` is the browser-confirmed GitHub/device-style path,
  while `slipway:ops login` remains sr25519 operator/admin recovery.
- Keep local session files and command output secret-safe. Bearer tokens must
  not appear in URLs, logs, JSON output, human output, errors, or debug text.
- Keep package verification focused on the npm/plugin surface: `dist`,
  `oclif.manifest.json`, and `README.md`.

## CLI Development Guidance

When changing CLI behavior, review Liran Tal's Node.js CLI Apps Best
Practices and its agent-oriented skill:

- https://github.com/lirantal/nodejs-cli-apps-best-practices
- https://github.com/lirantal/nodejs-cli-apps-best-practices/tree/main/skills/nodejs-cli-best-practices

Use it as a checklist for POSIX-style flags, structured output,
configuration precedence, actionable errors, debug output, exit codes, version
output, package `files`, strict opt-in analytics, and argument-injection
safety. Slipway's GitHub identity, custody, and secret-handling rules remain
stricter where they apply.

## Validation

Validation evidence belongs to the exact tree that produced it. Re-run this
matrix after the final merge, rebase, conflict resolution, generated manifest
update, or version change and before push:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node scripts/verify-package.mjs
pnpm pack:dry-run
pnpm smoke:proof-plugin
```

From a `proof-cli-liskov/.worktrees/<name>` checkout, set `PROOF_CLI_ROOT` to
the real root `proof-cli` checkout or to a dedicated `proof-cli` worktree before
running the smoke. The script's default sibling path is correct from the shared
checkout but otherwise resolves inside `.worktrees/`.

A version change is atomic across every file that represents it, generated
oclif/package artifacts, version assertions and release metadata. Do not assume
the lockfile records the root package version. Search for the old version and
explain every intentional retained occurrence; a green build alone is not
version-bump evidence.

## Release preflight

Do not create or push a release tag until the non-publishing workflow path has
passed on the exact commit:

```sh
gh workflow run npm-publish.yml --ref <branch> -f publish=false
```

Confirm the package name and version are the intended public coordinates, the
proposed tag is exactly `v` plus `package.json`'s version, the version is not
already published, and npm's trusted publisher names
`proof-computer/proof-cli-liskov` plus `.github/workflows/npm-publish.yml`.

```sh
set -euo pipefail
package_version="$(node -p "require('./package.json').version")"
test "<proposed-tag>" = "v${package_version}"
package_name="$(node -p "require('./package.json').name")"
published_versions="$(npm view "$package_name" versions --json)"
if node -e 'const v=JSON.parse(process.argv[1]); process.exit((Array.isArray(v)?v:[v]).includes(process.argv[2])?0:1)' "$published_versions" "$package_version"; then
  echo "$package_name@$package_version is already published" >&2
  exit 1
fi
```

The versions query itself must succeed; a network, registry, or authorization
error is a blocker, not evidence that the version is free. The dry run proves
the package artifact, not trusted-publisher authorization. If
the npm-side trusted-publisher configuration cannot be read, stop before a first
publish or after any repository/workflow identity change and name that external
verification as the blocker. Publication uses GitHub OIDC; do not add a
long-lived npm write token as a shortcut. After tagging, inspect the publish run
once and do not describe the release as complete until npm readback returns the
exact version.
