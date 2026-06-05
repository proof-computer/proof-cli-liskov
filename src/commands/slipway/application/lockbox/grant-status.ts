import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationLockboxGrantStatus } from "../../../../session.js";

export default class SlipwayApplicationLockboxGrantStatus extends Command {
  static args = {
    application_id: Args.string({ description: "Slipway Application id.", required: true })
  };
  static description = "Read Slipway Application Lockbox grant status.";
  static examples = [
    "<%= config.bin %> slipway application lockbox grant-status proof-docs",
    "<%= config.bin %> slipway application lockbox grant-status proof-docs --json",
    "<%= config.bin %> slipway application lockbox grant-status proof-docs --slipway-url https://slipway.proof.computer"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." })
  };
  static summary = "Read Slipway Application Lockbox grant status.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationLockboxGrantStatus);
    const code = await runSlipwayApplicationLockboxGrantStatus({
      applicationId: args.application_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
