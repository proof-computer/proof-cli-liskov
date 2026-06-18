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
  delete APP_REF [--owner OWNER] [--reason TEXT] [--force] [--yes]
  import --github owner/repo:path@ref [--server-fetch] [--publish]
  import --file PATH [--publish]
  list
  pause APP_REF [--owner OWNER] [--reason TEXT] [--yes]
  resume APP_REF [--owner OWNER] [--reason TEXT] [--yes]
  status APPLICATION_ID
  plans APPLICATION_ID
  deployment import APP_REF --sequence N --origin ADDRESS --yes
  lockbox setup-pr APP_REF --yes
  lockbox dispatch APP_REF --yes
  lockbox grant ensure APP_REF --yes
  lockbox grant verify APP_REF GRANT_ID --yes
  lockbox grant status APP_REF
  lockbox grant-status APPLICATION_ID
  blackbox configure APP_REF --yes

DESCRIPTION
  Application commands use the local proof liskov session created by
  \`${bin} liskov login\`. Pause stops new planning/executor work without
  stopping Acurast jobs, revoking Lockbox grants, or draining routes. Delete
  creates a Liskov tombstone.`);
}
