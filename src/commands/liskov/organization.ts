import { Command } from "@oclif/core";

export default class LiskovOrganization extends Command {
  static description = "Read Liskov organization and billing state.";
  static strict = false;
  static summary = "Read Liskov organization and billing state.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printOrganizationHelp(this.config.bin);
      return;
    }
    console.error(
      `[liskov] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof liskov organization command: ${this.argv.join(" ")}. ` +
      `Run \`${this.config.bin} liskov organization --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printOrganizationHelp(bin: string): void {
  console.log(`Liskov organization read commands.

USAGE
  $ ${bin} liskov organization <command> [options]

COMMANDS
  list
  billing ORG_ID
  service-credits ORG_ID
  billing transactions ORG_ID [--limit N] [--before MS]

DESCRIPTION
  These commands are read-only and use the local proof liskov session created
  by \`${bin} liskov login\`.`);
}
