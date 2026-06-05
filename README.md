# PROOF CLI Slipway Plugin

Private oclif plugin for Slipway commands under the root `proof` CLI.

```sh
proof slipway --help
proof slipway login --no-browser
proof slipway application import --github proof-computer/docs:.slipway/application-policy.json@main --server-fetch
proof slipway application list
proof slipway application status proof-docs
proof slipway application plans proof-docs --json
proof slipway application lockbox grant-status proof-docs --json
proof slipway application backfill-identities
proof slipway application delete proof-docs --reason retired --yes
proof slipway whoami --json
proof slipway logout
```

Slipway builder login is designed as a browser-confirmed GitHub device-style
flow. The CLI stores the local bearer token under an XDG-style config path and
never prints token material. The private `slipway:ops` sr25519 login remains an
operator recovery path, not the normal builder-facing command.

Application deletion is a logical Slipway tombstone. It removes the Application
from normal management/read surfaces but does not stop Acurast jobs, revoke
Lockbox grants, drain routes, or spend.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

To smoke the plugin through the root CLI:

```sh
pnpm run smoke:proof-plugin
```
