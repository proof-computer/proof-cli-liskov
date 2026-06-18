import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyAccountEnsure } from "../../../../session.js";

export default class SlipwayCustodyAccountEnsure extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Ensure a repo-scoped Liskov live custody account.";
  static examples = [
    "<%= config.bin %> liskov custody account ensure proof-docs --chain acurast --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    chain: Flags.string({ default: "acurast", description: "Custody chain.", options: ["acurast"] }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm custody account creation if needed." })
  };
  static summary = "Ensure a custody account.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyAccountEnsure);
    const code = await runSlipwayCustodyAccountEnsure({
      applicationRef: args.app_ref,
      chain: "acurast",
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
