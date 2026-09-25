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
proof liskov application execution show proof-docs
proof liskov application execution show proof-docs --watch --timeout-seconds 900
proof liskov application policy publish proof-docs --file .liskov/proof-docs-v5.json --artifact-digest sha256:... --binding-revision 1 --revocation-epoch 0 --source-ref refs/heads/main --source-commit 0123456789abcdef0123456789abcdef01234567 --workflow-identity proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main --expected-pointer-version 0 --yes
proof liskov application policy publish lab-inference-shell --file .liskov/lab-inference-shell.pinned.json --artifact-digest sha256:... --expected-pointer-version 0 --dry-run
proof liskov application source-binding set proof-docs --repository proof-computer/proof-docs --allowed-ref refs/heads/main --workflow-identity proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main --manifest-path .liskov/proof-docs-v5.json --yes
proof liskov application source-binding show proof-docs
proof liskov application source-binding revoke proof-docs --expected-revision 1 --reason "credential exposure" --yes
proof liskov application import --github proof-computer/docs:.slipway/application-policy.json@main --server-fetch
proof liskov application list
proof liskov application list --organization org-123
LISKOV_ORGANIZATION=team-slug proof liskov application status proof-docs
proof liskov application status proof-docs
proof liskov application plans proof-docs --json
proof liskov application secrets proof-docs
proof liskov application secrets proof-docs --json
proof liskov application vars list proof-docs
proof liskov application vars set proof-docs RPC_URL wss://rpc.example
proof liskov application vars set proof-docs RPC_URL wss://rpc.example --yes
proof liskov application vars unset proof-docs RPC_URL --yes
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
proof liskov application run proof-docs
proof liskov application run proof-docs --reason "rerun after data fix" --yes
proof liskov application hold release proof-docs
proof liskov application hold release proof-docs --reason "config fixed" --yes
proof liskov application retire proof-docs
proof liskov application retire proof-docs --reason "project complete" --yes
proof liskov application retire cancel proof-docs --yes
proof liskov application retirement-census
proof liskov application retirement-census --organization proof --lifecycle retiring
proof liskov application retirement-census --remediation-class operator_adjudication --json
proof liskov application devtools view-key proof-docs 66059 --json
proof liskov application runtime-image workflow proof-docs --manifest .liskov/proof-docs.json
proof liskov application deployment import proof-docs --sequence 701 --origin 5... --yes
proof liskov runtime-ssh integration list org-123
proof liskov runtime-ssh integration create org-123 --name "Production tailnet" --tailnet example.com --tag tag:liskov-runtime --oauth-client-id CLIENT_ID
proof liskov runtime-ssh integration validate org-123 int_123
proof liskov runtime-ssh integration rotate org-123 int_123 --oauth-client-id NEW_CLIENT_ID
proof liskov runtime-ssh integration disable org-123 int_123
proof liskov runtime-ssh operator-key list org-123
proof liskov runtime-ssh operator-key add org-123 --name patrick-mbp --identity ~/.ssh/id_ed25519
proof liskov runtime-ssh operator-key remove org-123 key_123
proof liskov runtime-ssh withdrawn-key list org-123
proof liskov runtime-ssh withdrawn-key add org-123 --fingerprint SHA256:... --reason "left the team"
proof liskov runtime-ssh withdrawn-key remove org-123 rsw_123
proof liskov runtime-ssh attachment list org-123 --include-terminal
proof liskov runtime-ssh attachment revoke org-123 att_123
proof liskov ssh proof-docs --print-command
proof liskov ssh proof-docs --deployment dep-123 --job job-123
proof liskov ssh proof-docs --job 155468
proof liskov application backfill-identities
# Deprecated clean-only compatibility bridge; use application retire.
proof liskov application delete proof-docs
proof liskov application delete proof-docs --reason retired --yes
proof liskov admin executor-operation reconcile op-123 --expect-application slipway-diagnostic --expect-kind runtime_replacement --expect-deployment dep-123 --expect-job job-123 --expect-status pending --reason "terminalize unsubmitted replacement" --json
proof liskov admin deploy-spend resolve reserve-123 --expect-organization org-1 --expect-application app-1 --expect-deployment dep-1 --expect-execution exec-1 --expect-billing-transaction tx-1 --expect-status review_required --final-usd-micros 25000 --evidence-ref case:123 --evidence-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --reason "reviewed chain evidence" --json
proof liskov admin retirement adjudicate-lineage app-uid --operation op-1 --expect-organization org-1 --expect-application app-1 --expect-application-uid app-uid --expect-operation-kind deploy_submit --expect-operation-status review_required --expect-deployment dep-1 --expect-job job-1 --expect-reserve reserve-1 --expect-reserve-status review_required --expect-billing-transaction tx-1 --expect-billing-status review_required --actor-id admin-1 --evidence-ref ticket://k4jz --evidence-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --reason "finalized JobRegistrationStartInPast" --json
proof liskov whoami --json
proof liskov logout
```

Liskov builder login is designed as a browser-confirmed GitHub device-style
flow. The CLI stores the local bearer token under an XDG-style config path and
never prints token material. Application mutation commands and the
operator-only custody commands are private/internal plugin commands that use the
saved GitHub App CLI session and the server's readable-Application checks. The
private `liskov:ops` sr25519 login remains an operator recovery path, not the
normal builder-facing command.

Liskov commands report one bounded completion event to the Liskov API by
default: the command id, plugin version, and success or failure. Arguments,
flag values, output, local paths, application names, and token material are not
included. Add `--no-analytics` to any invocation to suppress that event.

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

`application retirement-census` is the organization-scoped, read-only view of
safe Application retirement. It is authorized by an active organization
membership rather than by a per-Application repository binding, so it also
describes Applications that `application retire <ref>` refuses, reporting the
refusal as a coverage failure instead of hiding the row. It groups blocker
facts into correlated obligations: one unresolved obligation is otherwise
reported once by the canonical job, once by the deploy-spend reserve, and once
by the billing parent, so raw fact counts overstate how much is wrong. Human
output reports Applications, raw facts, and correlated obligations as three
distinct quantities, and leads with the causes rather than a per-row worklist.
Pages are bounded (`--limit`, default 25, maximum 100) and walked with
`--cursor`; `--all` follows every page and cannot be combined with `--json`,
which emits one canonical page unchanged. The command starts no retirement and
resolves no review.

`application secrets` reads the managed secrets an Application's active
policy requires and whether each is present; values are never shown.

`application vars list` reads the managed variables an Application's active
policy declares, with each value in the clear: a managed variable is
non-secret by contract, so put credentials in Secrets. `application vars set
APP_REF NAME VALUE` stores one value verbatim (`""` is a value; pass a value
that starts with a dash after `--`), and `application vars unset APP_REF NAME`
clears it back to the declared default or to unset. Set and unset are dry runs
by default: they show the current and resulting value and write nothing unless
`--yes` is present. The commands set values only; declaring or removing a
variable is a policy change. A refused write exits 1 with the server's code as
`reason` (`undeclared_variable`, `variable_value_too_large`, …).

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
secret grants, drain routes, or spend.

Pause and resume stop or restart only new Liskov planning/executor work; they
do not stop existing Acurast jobs, revoke secret grants, drain routes, or
spend.

Run asks a settled `once` Application to run once more. It authorizes exactly
one further occurrence, against the Application's current published revision,
and refuses a continuous or interval Application — those schedule their own
occurrences. It records intent: the dry run names the jobs, the paid window and
the Service Credit reserve a run would open, and the executor's own admission
checks remain the authority for whether the run happens. Pressing Run twice
while the first is unspent is one run, not two.

Pause, resume, run, delete, and identity backfill dry-run by default and require
`--yes` to mutate. Publish, other mutating Application commands and the mutating
operator-only custody commands require `--yes`; live execution submit also
requires `--yes-spend`. The plugin does not expose the old direct manual Acurast
spend fallback; diagnostics and machine catalog reads stay server-side.

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

Registered V5 publication of a source release is a distinct source-evidence
path: `application create` (identity, with `--repository`) then
`application source-binding set` then the attesting workflow, then
`application policy publish`. `source-binding set` is the admin-only bind
step over `PUT /api/applications/{id}/source-binding`; omit
`--expected-revision` on create (`0` means update revision 0 and conflicts).
`show` is an `application.read`; 404 `source_binding_not_found` means not
bound yet. `revoke` advances the revocation epoch and a later `set` must name
it. Set and revoke send no request without `--yes`. There is no default for
`--allowed-ref`.

`application policy publish` validates the retained schema-5 document locally,
requires the observed active-pointer version and the release facts its
`release.mode` selects, then submits them to the server-owned `policy-versions`
writer. It never creates a V4 draft, and no request is sent without `--yes`.
Both release modes take `--expected-pointer-version`, `--dry-run`,
`--paused`/`--reason` and `--json` alike:

- **`source`** (`release: {mode: source}`) — Liskov built the artifact from the
  bound repository. `--artifact-digest` plus the attested build's evidence are
  all required: `--binding-revision`, `--revocation-epoch`, `--source-ref`,
  `--source-commit` and `--workflow-identity`.
- **`pinned`** (`release: {mode: pinned, artifact: {digest}}`) — an artifact
  already pinned to the Application, run without a source build.
  `--artifact-digest` is required and must equal `release.artifact.digest`; a
  mismatch is `SLIPWAY_APPLICATION_POLICY_PUBLISH_MANIFEST_INVALID` at
  `/release/artifact/digest`. The flag is your assertion and the manifest is the
  document, so neither overrides the other. A pinned release has no source
  binding: any of the five build-evidence flags is a usage error
  (`SLIPWAY_APPLICATION_POLICY_PUBLISH_INVALID`). Human output adds
  `Release: pinned artifact <digest>.` and `--json` adds
  `release: {mode: "pinned", artifactDigest}` to the server's response.

Any other `release.mode` is refused locally as `unsupported_policy_feature`. On
success, human output renders the server-authored immutable policy diagnostics
with their severity, stable code, pointer, and message; `--json` preserves the
same `policyVersion.policyDiagnostics` records unchanged.

`application execution show` reads the same canonical explanation envelope as
`application policy explain` and renders its `execution` and `spendCloseout`
sections as the typed-spine run: the selected occurrence and attempt, the stage
rail, the deploy and custody-settlement effects with their persisted receipts
and job id, the reserve/settlement lineage, the first persisted blocker with the
server's next action, and the decision trace. `--json` prints the verbatim
server envelope. `--watch` re-reads it every `--poll-ms` (default 2000, minimum
500) for up to `--timeout-seconds` (default 900, maximum 1800) and prints one
line per semantic change (`--json` emits one NDJSON record per change with the
`changedPaths`); it exits 0 when the occurrence completes, 1 on a failed
terminal, a persisted blocker (unless `--until-terminal`) or the timeout, 2 on
invalid flags, and 130 on Ctrl-C after a final snapshot. A fact the server did
not report renders as "not reported"; the CLI never infers execution state.

`application publish --paused --reason TEXT --yes` publishes and pauses in one
server transaction, so the executor cannot observe an intermediate active
Application. The platform-admin executor-operation reconciliation command is a
dry-run unless `--yes`; it requires exact identity expectations and refuses any
placeholder with lease, proposal, chain/contact evidence, a later replacement,
or non-terminal billing correlation.

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

## Operator-only commands

The `proof liskov custody` namespace is internal Liskov operator tooling for
live custody of internal Applications. It is hidden from `proof --help`,
`proof liskov --help` and command listings, and it is not part of the customer
command contract. Every command keeps its name, flags, output and behaviour, and
`proof liskov custody --help` lists them for operators.

```sh
proof liskov custody account ensure proof-docs --chain acurast --yes
proof liskov custody signer status proof-docs --json
proof liskov custody preflight proof-docs --json
proof liskov custody execution run-one proof-docs --plan-item-id PLAN_ITEM_ID_FROM_ONE_ITEM --idempotency-key OPAQUE_KEY_FROM_SAME_ITEM --expect-kind acurast.deploy --expect-policy-digest POLICY_DIGEST_FROM_SAME_ITEM --yes-spend --yes
proof liskov custody environment upload proof-docs --secrets-file .env.local --yes
proof liskov custody execution list proof-docs --json
proof liskov custody execution submit proof-docs --plan-item-id ID --idempotency-key KEY --yes-spend --yes
proof liskov custody execution observe proof-docs --execution-id ID --json
proof liskov custody execution diagnose proof-docs --execution-id ID --network mainnet --json
proof liskov custody execution recover proof-docs --execution-id ID --reason "operator reviewed" --yes
proof liskov custody machine catalog --network mainnet --json
```

For guarded `custody execution run-one` submit mode, first run `custody
preflight APP_REF --json`. Choose one `actionPlan.items[]` entry whose
`executorMode` is `custodial.live`, then copy both its `planItemId` and its
opaque `idempotencyKey` unchanged into the run-one command. Never generate or
replace the key. After both confirmation flags are present, the CLI fetches a
fresh UID-scoped preflight, validates the pair plus the expected kind, policy
digest, optional deployment, and blockers, and only then sends the guarded
submit. If a timestamp-derived plan ID changed, the unchanged unique returned
key may select the refreshed ID; the server remains the final authority.

## Advanced: secret-grant plumbing

`application secrets` is the customer path for managed secrets. The
`application lockbox` commands below are lower-level secret-grant plumbing that
builders rarely need; they stay runnable under their existing command ids, but
ordinary help no longer lists them.

```sh
proof liskov application lockbox setup-pr proof-docs --yes
proof liskov application lockbox dispatch proof-docs --yes
proof liskov application lockbox grant ensure proof-docs --yes
proof liskov application lockbox grant status proof-docs --json
proof liskov application lockbox grant-status proof-docs --json
```

## Development

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node scripts/verify-package.mjs
pnpm pack:dry-run
```

To smoke the plugin through the root CLI:

```sh
pnpm run smoke:proof-plugin
```

`CLI CI` runs this complete matrix on pull requests and every push to `main`.
The `CLI validation` check includes the plugin smoke through a pinned checkout
of `proof-computer/proof-cli` at `02775f47b63b726cc515163200ec51e43ce72090`,
using Node 24.5.0 and pnpm 10.33.0. From a worktree, set `PROOF_CLI_ROOT` to
that root CLI checkout. CI has read-only repository permissions and does not
publish packages or invoke live Liskov actions.

### Publish a registered policy while paused

`application policy publish` supports `--paused --reason TEXT` for required
secret setup, for a source or a pinned release. Use `--dry-run` to preview the
exact artifact (and, for a source release, its source binding) and the
active-pointer fence without committing. Replace `--dry-run` with `--yes` to
publish and pause in one transaction, configure the declared secrets, then use
`application resume --reason TEXT --yes` when execution is intended. Publication
of a `once` policy normally starts a spend event; the paused form holds planning.

`--dry-run` and `--yes` are mutually exclusive. A pause reason must contain
1–500 characters after trimming. A stale `--expected-pointer-version` refuses;
read the new pointer and review again before confirming. These options require
a server supporting registered publication previews and atomic setup holds.
