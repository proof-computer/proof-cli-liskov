import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationPolicyExplain } from "../../../../session.js";

export default class LiskovApplicationPolicyExplain extends OrganizationScopedCommand {
  static args = {
    application_id: Args.string({ description: "Liskov Application id.", required: true })
  };
  static description = "Read the canonical retained V5 policy explanation envelope without recomputing policy, spend, or eligibility.";
  static examples = [
    "<%= config.bin %> liskov application policy explain proof-docs",
    "<%= config.bin %> liskov application policy explain proof-docs --json",
    "<%= config.bin %> liskov application policy explain proof-docs --slipway-url https://liskov.proof.computer"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Read canonical retained V5 policy explanation.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationPolicyExplain);
    const code = await runSlipwayApplicationPolicyExplain({
      applicationId: args.application_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
