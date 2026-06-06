import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionObserve } from "../../../../session.js";

export default class SlipwayCustodyExecutionObserve extends Command {
  static args = {
    app_ref: Args.string({ description: "Slipway Application uid, name, or legacy id.", required: true })
  };
  static description = "Observe a submitted Slipway live custody execution.";
  static examples = [
    "<%= config.bin %> slipway custody execution observe proof-docs --execution-id live-execution:abc --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    "execution-id": Flags.string({ description: "Live custody execution id.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." })
  };
  static summary = "Observe a live custody execution.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionObserve);
    const code = await runSlipwayCustodyExecutionObserve({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      executionId: flags["execution-id"] as string,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
