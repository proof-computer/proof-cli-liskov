# PROOF CLI Slipway Plugin

Private oclif plugin for Slipway commands under the root `proof` CLI.

```sh
proof slipway --help
proof slipway login --no-browser
proof slipway application import --github proof-computer/docs:.slipway/application-policy.json@main --server-fetch
proof slipway application status proof-docs
proof slipway application plans proof-docs --json
proof slipway application lockbox grant-status proof-docs --json
proof slipway whoami --json
proof slipway logout
```

Slipway builder login is designed as a browser-confirmed GitHub device-style
flow. The CLI stores the local bearer token under an XDG-style config path and
never prints token material. The private `slipway:ops` sr25519 login remains an
operator recovery path, not the normal builder-facing command.

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
