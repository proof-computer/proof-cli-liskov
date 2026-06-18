import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyChildRecover } from "../../../../session.js";

export default class SlipwayCustodyChildRecover extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Recover a reviewed live custody child session.";
  static examples = [
    "<%= config.bin %> liskov custody child recover proof-docs --child-session-id child-1 --reason \"operator reviewed\" --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    "child-session-id": Flags.string({ description: "Live custody child session id.", required: true }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    reason: Flags.string({ description: "Operator review reason.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm child-session recovery." })
  };
  static summary = "Recover a live custody child session.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyChildRecover);
    const code = await runSlipwayCustodyChildRecover({
      applicationRef: args.app_ref,
      childSessionId: flags["child-session-id"] as string,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      reason: flags.reason as string,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
