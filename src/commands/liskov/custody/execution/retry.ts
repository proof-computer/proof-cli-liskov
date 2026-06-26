import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionRetry } from "../../../../session.js";

export default class SlipwayCustodyExecutionRetry extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Retry a reviewed live custody execution and reset retry budgets.";
  static examples = [
    "<%= config.bin %> liskov custody execution retry proof-docs --execution-id live-execution:abc --reason \"operator retry\" --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "execution-id": Flags.string({ description: "Live custody execution id.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    reason: Flags.string({ description: "Operator retry reason.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm execution retry." })
  };
  static summary = "Retry a live custody execution.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionRetry);
    const code = await runSlipwayCustodyExecutionRetry({
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
