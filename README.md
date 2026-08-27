# PROOF CLI Liskov Plugin

Private oclif plugin for Liskov commands under the root `proof` CLI.

```sh
proof liskov --help
proof liskov login --no-browser
proof liskov login --session-token TOKEN --liskov-url http://127.0.0.1:8787
proof liskov organization list
proof liskov organization use org-123
proof liskov organization billing org-123
proof liskov organization service-credits org-123
proof liskov organization billing transactions org-123 --limit 25 --before 1719230000000
proof liskov application manifest validate --file .slipway/application-policy.json
proof liskov application policy publish proof-docs --file .liskov/proof-docs-v5.json --artifact-digest sha256:... --binding-revision 1 --revocation-epoch 0 --source-ref refs/heads/main --source-commit 0123456789abcdef0123456789abcdef01234567 --workflow-identity proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main --expected-pointer-version 0 --yes
proof liskov application import --github proof-computer/docs:.slipway/application-policy.json@main --server-fetch
proof liskov application list
proof liskov application list --organization org-123
LISKOV_ORGANIZATION=team-slug proof liskov application status proof-docs
proof liskov application status proof-docs
proof liskov application plans proof-docs --json
proof liskov application logs proof-docs --limit 100
proof liskov application logs proof-docs --deployment dep-123 --job job-123 --origin runtime-ssh --json
proof liskov application logs proof-docs --follow
proof liskov application logs proof-docs --from-start --ndjson
proof liskov application logs proof-docs --follow --event 'runtime.access.*'
proof liskov application publish proof-docs --artifact-version av-... --dry-run
proof liskov application publish proof-docs --artifact-version av-... --yes
proof liskov application publish proof-docs --paused --reason "failure-matrix initialization" --yes
proof liskov application pause proof-docs --reason "funding pending" --yes
proof liskov application resume proof-docs --reason "funded" --yes
proof liskov application retire proof-docs
proof liskov application retire proof-docs --reason "project complete" --yes
proof liskov application retire cancel proof-docs --yes
proof liskov application devtools view-key proof-docs 66059 --json
proof liskov application runtime-image workflow proof-docs --manifest .liskov/proof-docs.json
proof liskov application deployment import proof-docs --sequence 701 --origin 5... --yes
proof liskov application lockbox setup-pr proof-docs --yes
proof liskov application lockbox dispatch proof-docs --yes
proof liskov application lockbox grant ensure proof-docs --yes
proof liskov application lockbox grant status proof-docs --json
proof liskov application lockbox grant-status proof-docs --json
proof liskov runtime-ssh integration list org-123
proof liskov runtime-ssh integration create org-123 --name "Production tailnet" --tailnet example.com --tag tag:liskov-runtime --oauth-client-id CLIENT_ID
proof liskov runtime-ssh integration validate org-123 int_123
proof liskov runtime-ssh integration rotate org-123 int_123 --oauth-client-id NEW_CLIENT_ID
proof liskov runtime-ssh integration disable org-123 int_123
proof liskov runtime-ssh operator-key list org-123
proof liskov runtime-ssh operator-key add org-123 --name patrick-mbp --identity ~/.ssh/id_ed25519
proof liskov runtime-ssh operator-key remove org-123 key_123
proof liskov ssh proof-docs --print-command
proof liskov ssh proof-docs --deployment dep-123 --job job-123
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
# Deprecated clean-only compatibility bridge; use application retire.
proof liskov application delete proof-docs
proof liskov application delete proof-docs --reason retired --yes
proof liskov admin executor-operation reconcile op-123 --expect-application slipway-diagnostic --expect-kind runtime_replacement --expect-deployment dep-123 --expect-job job-123 --expect-status pending --reason "terminalize unsubmitted replacement" --json
proof liskov admin deploy-spend resolve reserve-123 --expect-organization org-1 --expect-application app-1 --expect-deployment dep-1 --expect-execution exec-1 --expect-billing-transaction tx-1 --expect-status review_required --final-usd-micros 25000 --evidence-ref case:123 --evidence-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --reason "reviewed chain evidence" --json
proof liskov whoami --json
proof liskov logout
```

Liskov builder login is designed as a browser-confirmed GitHub device-style
flow. The CLI stores the local bearer token under an XDG-style config path and
never prints token material. Application mutation and live custody commands are
private/internal plugin commands that use the saved GitHub App CLI session and
the server's readable-Application checks. The private `liskov:ops` sr25519
login remains an operator recovery path, not the normal builder-facing command.

Organization billing, Service Credit, and billing-transaction commands are
read-only projections of the existing Liskov routes. Network-backed
organization-scoped commands accept an exact organization ID or slug through
`--organization SELECTOR` or `LISKOV_ORGANIZATION`. The flag takes precedence
over the environment, and both override only the current command; otherwise
the saved session organization is used. Existing positional organization
selectors take precedence over both sources. `organization use [SELECTOR]` is
the one command that intentionally changes the selected organization on the
server-side session. `organization list`, login/logout, access/admin commands,
local manifest validation, and local workflow generation are unscoped. The
billing commands' `--json` output is the raw response object. Human transaction
rows omit provider references and memos. Execution-history reads remain
unbounded when pagination flags are omitted; human output reports returned
count, total, and next offset.

Application logging is opt-in through Manifest V4
`observability.logs.enabled`. Liskov provisions and reads it as a managed
capability; `application logs` is read-only and its `--json` output is the core
`/logs` response. Human output escapes terminal control characters in log
messages. A successful degraded response exits zero and reports its stable
availability reason.

`application logs` can also stream and paginate through the service's cursor
mode. `--follow` prints one newest-first page as oldest-first context, then
polls forward from the service's `latestCursor` every two seconds until
interrupted; transient poll failures warn on stderr and the command exits
non-zero only after 30 consecutive failures. `--from-start` drains the full
retained history oldest-first by following `nextCursor` until an empty page,
and combined with `--follow` it keeps streaming from the drain's last cursor
without duplicates. `--ndjson` emits one raw log record JSON object per line
with no header or footer, and `--event GLOB` filters records client-side by
their `event` field (`*` matches any run of characters; records without an
event are dropped). `--origin runtime_ssh` is accepted as an alias for
`runtime-ssh`. `--json` remains the verbatim one-shot response and cannot be
combined with `--follow`, `--from-start`, `--ndjson`, or `--event`. Against a
service that does not yet support cursor pagination, `--follow`/`--from-start`
fail with `SLIPWAY_APPLICATION_LOGS_PAGINATION_UNSUPPORTED`.

Application deletion is a logical Liskov tombstone. Without `--yes`, the CLI
uses the read-only deletion-preview endpoint and sends no mutation body. With
`--yes`, it sends a guarded DELETE that requires a reason and, when needed,
explicit live-resource acknowledgement. Tombstoning removes the Application
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

Runtime SSH is a private-preview, bring-your-own Tailscale capability. Starter,
Team, and Enterprise organization owners or administrators connect their own
Tailscale account and tailnet; Liskov does not provide a shared tailnet or
automatically create, install, authenticate, or switch a local Tailscale
client. Creating or rotating an integration reads the OAuth client secret from
stdin when input is piped, or from a protected no-echo terminal prompt. Do not
put the secret in a command-line flag or environment variable.

Before enabling Runtime SSH, confirm that the customer-owned Tailscale SSH
policy grants only the intended operators access as the PRoot `root` identity.
The customer owns the account, tailnet, tag, grants, identity policy, audit,
and provider charges. `proof liskov ssh APP` asks the server to resolve one
ready exact-job attachment, checks that the existing local Tailscale client is
authenticated to that attachment's expected tailnet, then launches
`tailscale ssh root@HOST`. Use `--deployment` or `--job` when more than one
attachment is ready. `--print-command` performs the same resolution and local
tailnet check without opening an SSH session.

Application import accepts authored manifests only, never publishes, and
returns both `authoredDigest` and `releaseIntentDigest`. Build-release
publication selects an exact `--artifact-version`; `--dry-run` calls the
read-only publication preflight. Actual publication observes preflight first
and submits its `authoredDigest` as the race fence.

Registered V5 publication is a distinct source-evidence path:
`application policy publish` validates the retained schema-5 document locally,
requires the exact attested artifact/build facts and observed active-pointer
version, then submits them to the server-owned `policy-versions` writer. It
never creates a V4 draft, and no request is sent without `--yes`.

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

`proof liskov application runtime-image workflow APP_ID --manifest PATH`
writes a manual GitHub Actions caller for the manifest-bound runtime-image
pipeline at
`proof-computer/liskov-github-actions/.github/workflows/runtime-image.yml@v1`.
The CLI first verifies that `PATH` is a valid repo-relative V4 build manifest
for `APP_ID`, that its artifact kind is `runtime_image`, and that its authored
`builder.manifestPath` exactly matches `PATH`. At dispatch time the reusable
workflow imports that manifest, downloads the supplied image URL, and binds the
one-run Tigris upload session to the server-authoritative authored and release
intent digests before upload and finalize. Use `--liskov-url` and
`--oidc-audience` to embed custom endpoints in the caller.

The active Application policy must allow the repository/ref under
`runtimeImageAutomation.github`; if it pins `workflowRef`, set it to the
generated caller path, such as
`<owner>/<repo>/.github/workflows/liskov-runtime-image.yml@refs/heads/<branch>`.

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
