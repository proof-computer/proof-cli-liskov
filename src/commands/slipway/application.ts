import { Command } from "@oclif/core";

export default class SlipwayApplication extends Command {
  static description = "Read Slipway Application state.";
  static strict = false;
  static summary = "Read Slipway Application state.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayApplicationHelp(this.config.bin);
      return;
    }

    console.error(
      `[slipway] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof slipway application command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} slipway application --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayApplicationHelp(bin: string): void {
  console.log(`Slipway Application commands.

USAGE
  $ ${bin} slipway application <command> [options]

COMMANDS
  import --github owner/repo:path@ref [--server-fetch] [--publish]
  import --file PATH [--publish]
  status APPLICATION_ID
  plans APPLICATION_ID
  lockbox grant-status APPLICATION_ID

DESCRIPTION
  Read-only Application commands use the local proof slipway session created
  by \`${bin} slipway login\`.`);
}
