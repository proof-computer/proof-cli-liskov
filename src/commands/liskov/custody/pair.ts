import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyPair } from "../../../session.js";

export default class SlipwayCustodyPair extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Issue a self-custody signer pairing token for a Liskov Application.";
  static examples = [
    "<%= config.bin %> liskov custody pair proof-docs",
    "<%= config.bin %> liskov custody pair proof-docs --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Issue a self-custody signer pairing token.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyPair);
    const code = await runSlipwayCustodyPair({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
