import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationBlackboxConfigure } from "../../../../session.js";

export default class SlipwayApplicationBlackboxConfigure extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Configure production Blackbox logging for a Liskov Application.";
  static examples = [
    "<%= config.bin %> liskov application blackbox configure proof-docs --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the Blackbox configuration mutation." })
  };
  static summary = "Configure Blackbox logging.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationBlackboxConfigure);
    const code = await runSlipwayApplicationBlackboxConfigure({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
