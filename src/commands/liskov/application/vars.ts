import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class LiskovApplicationVars extends OrganizationScopedCommand {
  static description = "Read and set the managed variable values an Application's active policy declares.";
  static strict = false;
  static summary = "Read and set Application managed variable values.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printVarsHelp(this.config.bin);
      return;
    }

    console.error(
      `[liskov] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof liskov application vars command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} liskov application vars --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printVarsHelp(bin: string): void {
  console.log(`Liskov Application managed variable commands.

USAGE
  $ ${bin} liskov application vars <command> [options]

COMMANDS
  list APP_REF [--json]
  set APP_REF NAME VALUE [--yes] [--json]
  unset APP_REF NAME [--yes] [--json]

DESCRIPTION
  Vars commands use the local proof liskov session created by
  \`${bin} liskov login\`. A managed variable is declared by the
  Application's active policy; these commands read and write its value only.
  Declaring or removing a variable is a policy change. Values are plaintext by
  design; put credentials in Secrets. Set and unset show what would change and
  write nothing unless --yes is present. Pass a VALUE that starts with a dash
  after \`--\`.`);
}
