import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionList } from "../../../../session.js";

export default class SlipwayCustodyExecutionList extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "List Liskov live custody executions.";
  static examples = [
    "<%= config.bin %> liskov custody execution list proof-docs --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
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
