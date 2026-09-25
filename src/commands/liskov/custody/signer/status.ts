import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayCustodySignerStatus } from "../../../../session.js";

export default class SlipwayCustodySignerStatus extends OrganizationScopedCommand {
  static hidden = true;
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Show the self-custody signer bound to a Liskov Application: status, address, liveness and pending sign requests.";
  static examples = [
    "<%= config.bin %> liskov custody signer status proof-docs",
    "<%= config.bin %> liskov custody signer status proof-docs --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Show a self-custody signer's status.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodySignerStatus);
    const code = await runSlipwayCustodySignerStatus({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
