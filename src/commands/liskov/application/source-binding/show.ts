import { Args, Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationSourceBindingShow } from "../../../../session.js";

export default class LiskovApplicationSourceBindingShow extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description =
    "Read the current server-owned Application source binding. A 404 source_binding_not_found means the Application is not bound yet.";
  static examples = [
    "<%= config.bin %> liskov application source-binding show proof-docs",
    "<%= config.bin %> liskov application source-binding show proof-docs --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag()
  };
  static summary = "Read the Application source binding.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationSourceBindingShow);
    const code = await runSlipwayApplicationSourceBindingShow({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
