import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionList } from "../../../../session.js";

export default class SlipwayCustodyExecutionList extends Command {
  static args = {
    app_ref: Args.string({ description: "Slipway Application uid, name, or legacy id.", required: true })
  };
  static description = "List Slipway live custody executions.";
  static examples = [
    "<%= config.bin %> slipway custody execution list proof-docs --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." })
  };
  static summary = "List live custody executions.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionList);
    const code = await runSlipwayCustodyExecutionList({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
