import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyPreflight } from "../../../session.js";

export default class SlipwayCustodyPreflight extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Read live custody preflight state. For run-one submit, copy planItemId and the opaque idempotencyKey from the same custodial.live actionPlan item.";
  static examples = [
    "<%= config.bin %> liskov custody preflight proof-docs --json",
    "<%= config.bin %> liskov custody preflight proof-docs --preview-paused --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "preview-paused": Flags.boolean({ description: "Evaluate the paused application's current deploy policy without persisting a plan, proposal, reserve, or submission." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Read live custody preflight state.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyPreflight);
    const code = await runSlipwayCustodyPreflight({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      previewPaused: flags["preview-paused"] as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
