import { Command } from "@oclif/core";

export default class SlipwayApplicationLockbox extends Command {
  static description = "Read Slipway Application Lockbox state.";
  static strict = false;
  static summary = "Read Slipway Application Lockbox state.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayApplicationLockboxHelp(this.config.bin);
      return;
    }

    console.error(
      `[slipway] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof slipway application lockbox command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} slipway application lockbox --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayApplicationLockboxHelp(bin: string): void {
  console.log(`Slipway Application Lockbox commands.

USAGE
  $ ${bin} slipway application lockbox <command> [options]

COMMANDS
  grant-status APPLICATION_ID

DESCRIPTION
  Read-only Lockbox commands use the local proof slipway session created by
  \`${bin} slipway login\`.`);
}
