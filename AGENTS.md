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
  `oclif.manifest.json`, `README.md` and `LICENSE`.

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
pnpm check:floor
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

## Code floor (ADR-0284)

`pnpm typecheck` runs strict `tsc` over `src/`; tests run through `tsx`
and are not type-checked. `pnpm lint` checks hand-written `src/`, `test/`
and `scripts/` with ESLint's and typescript-eslint's recommended presets
(without type information), Node globals and unused disable directives as
errors. This configuration adds no disabled rules; the presets own their
TypeScript-specific overrides. `pnpm check:floor` runs lint and the marker
and size checks together.

A deferral comment beginning TODO, FIXME, XXX or HACK needs a `BKLG-…`,
`EPIC-…` or `Q-…` id on its line or the line above. A suppression of lint,
type checking, formatting, coverage or a test needs an id or a permanent,
justified reason. For comment directives, a reason follows ` -- `; for
`@ts-expect-error`, it follows the directive. `@ts-ignore` and `@ts-nocheck`
are refused by lint. A non-empty skip/todo option string or test-context
skip/todo string is its reason; a config setting or skipped test may instead
have a reason comment on its line or the line above. A test name alone is
not a reason. Strings, fixtures, generated-output ignores and `skipLibCheck`
are not markers. Existing anonymous markers are counted, not converted;
a touched marker gains its id or reason, or is removed.

The design target is 1,000 lines per module. A new hand-written source file
may not exceed 2,000 lines; a file already above 2,000 may not grow.
`src/session.ts`, `test/slipway.test.ts` and `test/runtime-ssh.test.ts` are
held at their counts in `scripts/floor-baseline.json`. A change adding lines
to one first moves at least as many lines into a module of its own in the
same change. Generated and vendored code, build output, JSON and fixtures
are outside the size hold.

`scripts/floor-baseline.json` records anonymous markers, bulk lint
suppressions and held files. These numbers only go down: lower the matching
baseline in the same change that removes a marker, fixes a suppressed
finding (also prune `eslint-suppressions.json`) or shrinks a held file.
Remove a held file from the list when it reaches 2,000 lines or fewer.
BKLG-20261108-fwlp records the initial lint and size debt; existing code is
counted and held rather than converted or split (ADR-0284 D24).

The factory gate must run the same checks as CI. `pnpm check:floor` is the
floor command; BKLG-20261108-e65a (D5) adds it to the pack's
`gates/proof-cli-liskov.sh` after this packet lands.

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
