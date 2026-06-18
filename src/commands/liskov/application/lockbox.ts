import { Command } from "@oclif/core";

export default class SlipwayApplicationLockbox extends Command {
  static description = "Read Liskov Application Lockbox state.";
  static strict = false;
  static summary = "Read Liskov Application Lockbox state.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayApplicationLockboxHelp(this.config.bin);
      return;
    }

    console.error(
      `[liskov] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof liskov application lockbox command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} liskov application lockbox --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayApplicationLockboxHelp(bin: string): void {
  console.log(`Liskov Application Lockbox commands.

USAGE
  $ ${bin} liskov application lockbox <command> [options]

COMMANDS
  setup-pr APP_REF --yes
  dispatch APP_REF --yes
  grant ensure APP_REF --yes
  grant verify APP_REF GRANT_ID --yes
  grant status APP_REF
  grant-status APPLICATION_ID

DESCRIPTION
  Lockbox commands use the local proof liskov session created by
  \`${bin} liskov login\`. The grant-status command remains a compatibility
  alias for grant status.`);
}
