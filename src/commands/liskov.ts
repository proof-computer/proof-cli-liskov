import { Command } from "@oclif/core";

export default class Liskov extends Command {
  static description = "Liskov application deployment commands.";
  static strict = false;
  static summary = "Liskov application deployment commands.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayRootHelp(this.config.bin);
      return;
    }

    console.error(
      `[liskov] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof liskov command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} liskov --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayRootHelp(bin: string): void {
  console.log(`Liskov application deployment commands.

USAGE
  $ ${bin} liskov <command> [options]

COMMANDS
  login
  organization list
  organization use ORG_ID
  organization billing ORG_ID
  organization service-credits ORG_ID
  organization billing transactions ORG_ID [--limit N] [--before MS]
  application import --github owner/repo:path@ref [--server-fetch]
  application list
  application manifest validate --file PATH [--json]
  application policy publish APP_REF --file PATH --artifact-digest SHA256 --binding-revision N --revocation-epoch N --source-ref REF --source-commit SHA --workflow-identity ID --expected-pointer-version N --yes
  application publish APP_REF [--artifact-version ID] [--dry-run] [--paused --reason TEXT] [--yes]
  application pause APP_REF --yes
  application resume APP_REF --yes
  application status APPLICATION_ID
  application execution show APPLICATION_ID [--json] [--watch] [--poll-ms N] [--timeout-seconds N] [--until-terminal]
  application plans APPLICATION_ID
  application action-plan APP_REF
  application action-plan retry APP_REF --decision-id ID --reason TEXT --yes
  application logs APP_REF [--limit N] [--deployment ID] [--job ID] [--origin all|customer|runtime-ssh|runtime_ssh] [--event GLOB] [--follow] [--from-start] [--ndjson] [--json]
  application devtools view-key APP_REF DEPLOYMENT_ID
  application runtime-image workflow APP_ID --manifest PATH [--output PATH]
  application deployment import APP_REF --sequence N --origin ADDRESS --yes
  application lockbox setup-pr APP_REF --yes
  application lockbox dispatch APP_REF --yes
  application lockbox grant ensure APP_REF --yes
  application lockbox grant status APP_REF
  application lockbox grant-status APPLICATION_ID
  custody account ensure APP_REF --chain acurast --yes
  custody preflight APP_REF
  custody environment upload APP_REF --secrets-file PATH --yes
  custody execution list APP_REF
  custody execution run-one APP_REF --execution-id ID --expect-kind KIND --expect-policy-digest DIGEST --yes
  custody execution run-one APP_REF --plan-item-id PREFLIGHT_ITEM_ID --idempotency-key OPAQUE_KEY_FROM_SAME_ITEM --expect-kind KIND --expect-policy-digest DIGEST --yes-spend --yes
  custody execution submit APP_REF --plan-item-id ID --idempotency-key KEY --yes-spend --yes
  custody execution observe APP_REF --execution-id ID
  custody execution diagnose APP_REF --execution-id ID
  custody execution recover APP_REF --execution-id ID --reason TEXT --yes
  custody execution retry APP_REF --execution-id ID --reason TEXT --yes
  custody machine catalog
  admin executor-operation reconcile OPERATION_ID --expect-application APP --expect-kind KIND --expect-deployment DEPLOYMENT --expect-job JOB --expect-status STATUS --reason TEXT [--yes]
  admin executor-operation recover-deploy-submit OPERATION_ID --expect-organization ORG --expect-application APP --expect-application-uid UID --expect-deployment DEPLOYMENT --expect-local-job JOB --expect-execution EXECUTION --expect-proposal PROPOSAL --expect-reserve RESERVE --expect-operation-status STATUS --expect-local-job-status STATUS --expect-reserve-status STATUS --finalized-block-number N --finalized-block-hash HASH --extrinsic-index N --transaction-hash HASH --reason TEXT [--yes]
  admin deploy-spend resolve RESERVE --expect-organization ORG --expect-application APP --expect-deployment DEP --expect-execution EXEC --expect-billing-transaction TX --expect-status review_required --final-usd-micros N --evidence-ref REF --evidence-sha256 SHA256 --reason TEXT [--yes]
  whoami
  logout

DESCRIPTION
  Liskov commands use native proof-cli-slipway entrypoints. Builder login is
  separate from the private liskov:ops operator recovery command surface.`);
}
