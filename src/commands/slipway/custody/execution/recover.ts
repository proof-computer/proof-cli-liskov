import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionRecover } from "../../../../session.js";

export default class SlipwayCustodyExecutionRecover extends Command {
  static args = {
    app_ref: Args.string({ description: "Slipway Application uid, name, or legacy id.", required: true })
  };
  static description = "Mark a reviewed live custody execution failed and release recovery state.";
  static examples = [
    "<%= config.bin %> slipway custody execution recover proof-docs --execution-id live-execution:abc --reason \"operator reviewed\" --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    "execution-id": Flags.string({ description: "Live custody execution id.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    reason: Flags.string({ description: "Operator review reason.", required: true }),
    "slipway-url": Flags.string({ description: "Slipway service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm execution recovery." })
  };
  static summary = "Recover a live custody execution.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionRecover);
    const code = await runSlipwayCustodyExecutionRecover({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      executionId: flags["execution-id"] as string,
      json: flags.json as boolean | undefined,
      reason: flags.reason as string,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
