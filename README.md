# PROOF CLI Slipway Plugin

Private oclif plugin for Slipway commands under the root `proof` CLI.

```sh
proof slipway --help
proof slipway login --no-browser
proof slipway application import --github proof-computer/docs:.slipway/application-policy.json@main --server-fetch
proof slipway application list
proof slipway application status proof-docs
proof slipway application plans proof-docs --json
proof slipway application deployment import proof-docs --sequence 701 --origin 5... --yes
proof slipway application lockbox setup-pr proof-docs --yes
proof slipway application lockbox dispatch proof-docs --yes
proof slipway application lockbox grant ensure proof-docs --yes
proof slipway application lockbox grant status proof-docs --json
proof slipway application lockbox grant-status proof-docs --json
proof slipway application blackbox configure proof-docs --yes
proof slipway custody account ensure proof-docs --chain acurast --yes
proof slipway custody preflight proof-docs --json
proof slipway custody environment upload proof-docs --secrets-file .env.local --yes
proof slipway custody execution list proof-docs --json
proof slipway custody execution submit proof-docs --plan-item-id ID --idempotency-key KEY --yes-spend --yes
proof slipway custody execution observe proof-docs --execution-id ID --json
proof slipway custody execution diagnose proof-docs --execution-id ID --network mainnet --json
proof slipway custody execution recover proof-docs --execution-id ID --reason "operator reviewed" --yes
proof slipway custody child recover proof-docs --child-session-id ID --reason "operator reviewed" --yes
proof slipway custody machine catalog --network mainnet --json
proof slipway application backfill-identities
proof slipway application delete proof-docs --reason retired --yes
proof slipway whoami --json
proof slipway logout
```

Slipway builder login is designed as a browser-confirmed GitHub device-style
flow. The CLI stores the local bearer token under an XDG-style config path and
never prints token material. Application mutation and live custody commands are
private/internal plugin commands that use the saved GitHub App CLI session and
the server's readable-Application checks. The private `slipway:ops` sr25519
login remains an operator recovery path, not the normal builder-facing command.

Application deletion is a logical Slipway tombstone. It removes the Application
from normal management/read surfaces but does not stop Acurast jobs, revoke
Lockbox grants, drain routes, or spend.

Mutating Application and custody commands require `--yes`. Live execution submit
also requires `--yes-spend`. The plugin does not expose the old direct manual
Acurast spend fallback; diagnostics and machine catalog reads stay server-side.

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
