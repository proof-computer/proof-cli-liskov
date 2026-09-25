import { Args, Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationVarsUnset } from "../../../../session.js";

export default class LiskovApplicationVarsUnset extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }),
    name: Args.string({ description: "Managed variable name declared by the active policy.", required: true })
  };
  static description =
    "Clear the stored value of a managed variable, falling back to its declared default or to unset. Without --yes, shows the current value and what clearing leaves, and writes nothing.";
  static examples = [
    "<%= config.bin %> liskov application vars unset proof-docs RPC_URL",
    "<%= config.bin %> liskov application vars unset proof-docs RPC_URL --yes"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag(),
    yes: Flags.boolean({ char: "y", description: "Confirm the clear. Without this flag the command is a dry run." })
  };
  static summary = "Clear a Liskov Application managed variable value.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationVarsUnset);
    const code = await runSlipwayApplicationVarsUnset({
      applicationRef: args.app_ref,
      name: args.name,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
