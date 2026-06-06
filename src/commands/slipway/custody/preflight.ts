import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyPreflight } from "../../../session.js";

export default class SlipwayCustodyPreflight extends Command {
  static args = {
    app_ref: Args.string({ description: "Slipway Application uid, name, or legacy id.", required: true })
  };
  static description = "Read live custody preflight state for a Slipway Application.";
  static examples = [
    "<%= config.bin %> slipway custody preflight proof-docs --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." })
  };
  static summary = "Read live custody preflight state.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyPreflight);
    const code = await runSlipwayCustodyPreflight({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
