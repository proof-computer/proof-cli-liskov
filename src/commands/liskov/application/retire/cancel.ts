import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationRetirementCancel } from "../../../../session.js";

export default class SlipwayApplicationRetireCancel extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Cancel an active Liskov Application retirement intent.";
  static examples = [
    "<%= config.bin %> liskov application retire cancel proof-docs --yes",
    "<%= config.bin %> liskov application retire cancel proof-docs --reason \"keep paused\" --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the canonical machine-readable retirement response." }),
    reason: Flags.string({ description: "Optional cancellation reason (maximum 500 characters)." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm cancellation. The Application remains paused." })
  };
  static summary = "Cancel retirement and leave the Liskov Application paused.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationRetireCancel);
    const code = await runSlipwayApplicationRetirementCancel({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
