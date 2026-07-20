# PROOF CLI Liskov Plugin

Private oclif plugin for Liskov commands under the root `proof` CLI.

```sh
proof liskov --help
proof liskov login --no-browser
proof liskov application import --github proof-computer/docs:.slipway/application-policy.json@main --server-fetch
proof liskov application list
proof liskov application status proof-docs
proof liskov application plans proof-docs --json
proof liskov application publish proof-docs --yes
proof liskov application publish proof-docs --paused --reason "failure-matrix initialization" --yes
proof liskov application pause proof-docs --reason "funding pending" --yes
proof liskov application resume proof-docs --reason "funded" --yes
proof liskov application devtools view-key proof-docs 66059 --json
proof liskov application runtime-image workflow proof-docs
proof liskov application deployment import proof-docs --sequence 701 --origin 5... --yes
proof liskov application lockbox setup-pr proof-docs --yes
proof liskov application lockbox dispatch proof-docs --yes
proof liskov application lockbox grant ensure proof-docs --yes
proof liskov application lockbox grant status proof-docs --json
proof liskov application lockbox grant-status proof-docs --json
proof liskov application blackbox configure proof-docs --yes
proof liskov custody account ensure proof-docs --chain acurast --yes
proof liskov custody preflight proof-docs --json
proof liskov custody execution run-one proof-docs --plan-item-id PLAN_ITEM_ID_FROM_ONE_ITEM --idempotency-key OPAQUE_KEY_FROM_SAME_ITEM --expect-kind acurast.deploy --expect-policy-digest POLICY_DIGEST_FROM_SAME_ITEM --yes-spend --yes
proof liskov custody environment upload proof-docs --secrets-file .env.local --yes
proof liskov custody execution list proof-docs --json
proof liskov custody execution submit proof-docs --plan-item-id ID --idempotency-key KEY --yes-spend --yes
proof liskov custody execution observe proof-docs --execution-id ID --json
proof liskov custody execution diagnose proof-docs --execution-id ID --network mainnet --json
proof liskov custody execution recover proof-docs --execution-id ID --reason "operator reviewed" --yes
proof liskov custody machine catalog --network mainnet --json
proof liskov application backfill-identities
proof liskov application delete proof-docs --reason retired --yes
proof liskov admin executor-operation reconcile op-123 --expect-application slipway-diagnostic --expect-kind runtime_replacement --expect-deployment dep-123 --expect-job job-123 --expect-status pending --reason "terminalize unsubmitted replacement" --json
proof liskov whoami --json
proof liskov logout
```

Liskov builder login is designed as a browser-confirmed GitHub device-style
flow. The CLI stores the local bearer token under an XDG-style config path and
never prints token material. Application mutation and live custody commands are
private/internal plugin commands that use the saved GitHub App CLI session and
the server's readable-Application checks. The private `liskov:ops` sr25519
login remains an operator recovery path, not the normal builder-facing command.

Application deletion is a logical Liskov tombstone. It removes the Application
from normal management/read surfaces but does not stop Acurast jobs, revoke
Lockbox grants, drain routes, or spend.

Pause and resume stop or restart only new Liskov planning/executor work; they
do not stop existing Acurast jobs, revoke Lockbox grants, drain routes, or
spend.

Pause, resume, delete, and identity backfill dry-run by default and require
`--yes` to mutate. Publish and other mutating Application and custody commands
require `--yes`; live execution submit also requires `--yes-spend`. The plugin does
not expose the old direct manual Acurast spend fallback; diagnostics and
machine catalog reads stay server-side.

`application publish --paused --reason TEXT --yes` publishes and pauses in one
server transaction, so the executor cannot observe an intermediate active
Application. The platform-admin executor-operation reconciliation command is a
dry-run unless `--yes`; it requires exact identity expectations and refuses any
placeholder with lease, proposal, chain/contact evidence, a later replacement,
or non-terminal billing correlation.

For guarded `custody execution run-one` submit mode, first run `custody
preflight APP_REF --json`. Choose one `actionPlan.items[]` entry whose
`executorMode` is `custodial.live`, then copy both its `planItemId` and its
opaque `idempotencyKey` unchanged into the run-one command. Never generate or
replace the key. After both confirmation flags are present, the CLI fetches a
fresh UID-scoped preflight, validates the pair plus the expected kind, policy
digest, optional deployment, and blockers, and only then sends the guarded
submit. If a timestamp-derived plan ID changed, the unchanged unique returned
key may select the refreshed ID; the server remains the final authority.

`proof liskov application runtime-image workflow APP_REF` writes a manual
GitHub Actions workflow for the stage 1-2 PRoot runtime-image upload path. The
workflow requests GitHub OIDC with audience `liskov-runtime-image-upload`,
downloads a pinned image URL supplied at dispatch time, asks Liskov for a
one-run Tigris upload session, uploads with `aws s3api put-object`, and calls
the Liskov finalize route with digest, byte size, object key, and provenance.
It does not store the returned Tigris secret key in the repository. The active
Application policy must allow the repository/ref under
`runtimeImageAutomation.github`; if it pins `workflowRef`, set it to
`<owner>/<repo>/.github/workflows/liskov-runtime-image.yml@refs/heads/<branch>`
or the path written with `--output`.

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
