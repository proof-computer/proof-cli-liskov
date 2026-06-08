import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationStatusTransition } from "../../../session.js";

export default class SlipwayApplicationPause extends Command {
  static args = {
    app_ref: Args.string({ description: "Slipway Application uid, name, or legacy id.", required: true })
  };
  static description = "Pause new Slipway work for an Application.";
  static examples = [
    "<%= config.bin %> slipway application pause proof-docs",
    "<%= config.bin %> slipway application pause proof-docs --reason \"funding pending\" --yes",
    "<%= config.bin %> slipway application pause app-0123456789abcdef --owner github:12345 --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    owner: Flags.string({ description: "Owner address to disambiguate a legacy Application id." }),
    reason: Flags.string({ description: "Pause reason recorded on the Application." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the pause mutation. Without this flag the server returns a dry run." })
  };
  static summary = "Pause new Slipway work for an Application.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationPause);
    const code = await runSlipwayApplicationStatusTransition({
      applicationRef: args.app_ref,
      status: "paused",
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      owner: flags.owner as string | undefined,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
