import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionDiagnose } from "../../../../session.js";

export default class SlipwayCustodyExecutionDiagnose extends Command {
  static args = {
    app_ref: Args.string({ description: "Slipway Application uid, name, or legacy id.", required: true })
  };
  static description = "Diagnose a live custody Acurast execution from Slipway.";
  static examples = [
    "<%= config.bin %> slipway custody execution diagnose proof-docs --execution-id live-execution:abc --network mainnet --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    "execution-id": Flags.string({ description: "Live custody execution id.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    network: Flags.string({ description: "Acurast network.", options: ["mainnet", "testnet", "canary"] }),
    "slipway-url": Flags.string({ description: "Slipway service URL." })
  };
  static summary = "Diagnose a live custody execution.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionDiagnose);
    const code = await runSlipwayCustodyExecutionDiagnose({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      executionId: flags["execution-id"] as string,
      json: flags.json as boolean | undefined,
      network: flags.network as never,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
