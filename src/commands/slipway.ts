import { Command } from "@oclif/core";

export default class Slipway extends Command {
  static description = "Slipway application deployment commands.";
  static strict = false;
  static summary = "Slipway application deployment commands.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayRootHelp(this.config.bin);
      return;
    }

    console.error(
      `[slipway] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof slipway command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} slipway --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayRootHelp(bin: string): void {
  console.log(`Slipway application deployment commands.

USAGE
  $ ${bin} slipway <command> [options]

COMMANDS
  login
  application import --github owner/repo:path@ref [--server-fetch] [--publish]
  application status APPLICATION_ID
  application plans APPLICATION_ID
  application lockbox grant-status APPLICATION_ID
  whoami
  logout

DESCRIPTION
  Slipway commands use native proof-cli-slipway entrypoints. Builder login is
  separate from the private slipway:ops operator recovery command surface.`);
}
