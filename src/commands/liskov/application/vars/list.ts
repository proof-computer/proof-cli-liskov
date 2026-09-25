import { Args, Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationVarsList } from "../../../../session.js";

export default class LiskovApplicationVarsList extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description =
    "List the managed variables an Application's active policy declares, with each value in the clear. Values are plaintext by design; put credentials in Secrets.";
  static examples = [
    "<%= config.bin %> liskov application vars list proof-docs",
    "<%= config.bin %> liskov application vars list proof-docs --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag()
  };
  static summary = "List Liskov Application managed variables.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationVarsList);
    const code = await runSlipwayApplicationVarsList({
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
