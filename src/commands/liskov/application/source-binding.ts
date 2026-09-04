import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class LiskovApplicationSourceBinding extends OrganizationScopedCommand {
  static description = "Manage the server-owned Application source binding.";
  static strict = false;
  static summary = "Manage the server-owned Application source binding.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSourceBindingHelp(this.config.bin);
      return;
    }

    console.error(
      `[liskov] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof liskov application source-binding command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} liskov application source-binding --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSourceBindingHelp(bin: string): void {
  console.log(`Liskov Application source-binding commands.

USAGE
  $ ${bin} liskov application source-binding <command> [options]

COMMANDS
  set APP_REF --repository OWNER/REPO --allowed-ref REF [--allowed-ref …] --workflow-identity IDENTITY --manifest-path PATH [--expected-revision N] [--reason TEXT] --yes
  show APP_REF
  revoke APP_REF --expected-revision N --reason TEXT --yes

DESCRIPTION
  Source-binding commands use the local proof liskov session created by
  \`${bin} liskov login\`. Set and revoke require an organization admin with
  application.source_binding.manage. Show is an application.read. Omit
  --expected-revision on the first bind; 0 means "update revision 0" and
  conflicts. There is no default for --allowed-ref.`);
}
