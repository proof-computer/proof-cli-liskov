import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationActionPlanRetry } from "../../../../session.js";

export default class SlipwayApplicationActionPlanRetry extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Retry a Liskov Application action-plan decision cohort.";
  static examples = [
    "<%= config.bin %> liskov application action-plan retry proof-docs --decision-id decision-abc --reason \"operator retry\" --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "decision-id": Flags.string({ description: "Action-plan decision id.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    reason: Flags.string({ description: "Operator retry reason.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm action-plan retry." })
  };
  static summary = "Retry an action-plan decision cohort.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationActionPlanRetry);
    const code = await runSlipwayApplicationActionPlanRetry({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      decisionId: flags["decision-id"] as string,
      json: flags.json as boolean | undefined,
      reason: flags.reason as string,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
