import { Command } from "@oclif/core";

export default class SlipwayApplication extends Command {
  static description = "Read Liskov Application state.";
  static strict = false;
  static summary = "Read Liskov Application state.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayApplicationHelp(this.config.bin);
      return;
    }

    console.error(
      `[liskov] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof liskov application command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} liskov application --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayApplicationHelp(bin: string): void {
  console.log(`Liskov Application commands.

USAGE
  $ ${bin} liskov application <command> [options]

COMMANDS
  backfill-identities [--yes]
  create APP_ID [--display-name NAME] [--repository owner/repo]
  delete APP_REF [--owner OWNER] [--reason TEXT] [--force] [--yes]
  import --github owner/repo:path@ref [--server-fetch]
  import --file PATH
  list
  publish APP_REF [--artifact-version ID] [--dry-run] [--paused --reason TEXT] [--yes]
  pause APP_REF [--owner OWNER] [--reason TEXT] [--yes]
  manifest validate --file PATH [--json]
  policy explain APPLICATION_ID [--json]
  policy publish APP_REF --file PATH --artifact-digest SHA256 --binding-revision N --revocation-epoch N --source-ref REF --source-commit SHA --workflow-identity ID --expected-pointer-version N --yes
  retire APP_REF [--reason TEXT] [--yes]
  retire cancel APP_REF [--reason TEXT] --yes
  resume APP_REF [--owner OWNER] [--reason TEXT] [--yes]
  status APPLICATION_ID
  plans APPLICATION_ID
  action-plan APP_REF
  action-plan retry APP_REF --decision-id ID --reason TEXT --yes
  logs APP_REF [--limit N] [--deployment ID] [--job ID] [--origin all|customer|runtime-ssh|runtime_ssh] [--event GLOB] [--follow] [--from-start] [--ndjson] [--json]
  devtools view-key APP_REF DEPLOYMENT_ID
  runtime-image workflow APP_ID --manifest PATH [--output PATH]
  deployment import APP_REF --sequence N --origin ADDRESS --yes
  lockbox setup-pr APP_REF --yes
  lockbox dispatch APP_REF --yes
  lockbox grant ensure APP_REF --yes
  lockbox grant verify APP_REF GRANT_ID --yes
  lockbox grant status APP_REF
  lockbox grant-status APPLICATION_ID

DESCRIPTION
  Application commands use the local proof liskov session created by
  \`${bin} liskov login\`. Pause stops new planning/executor work without
  stopping Acurast jobs, revoking Lockbox grants, or draining routes. Retire
  pauses immediately, waits for chain schedules and bounded financial closeout,
  then writes an immutable zero-gate receipt. Delete is a deprecated clean-only
  compatibility bridge.`);
}
