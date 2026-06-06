import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationLockboxGrantVerify } from "../../../../../session.js";

export default class SlipwayApplicationLockboxGrantVerify extends Command {
  static args = {
    app_ref: Args.string({ description: "Slipway Application uid, name, or legacy id.", required: true }),
    grant_id: Args.string({ description: "Lockbox grant id.", required: true })
  };
  static description = "Verify a production Lockbox grant for a Slipway Application.";
  static examples = [
    "<%= config.bin %> slipway application lockbox grant verify proof-docs lockbox-job-grant:abc --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the Lockbox grant verification mutation." })
  };
  static summary = "Verify a Lockbox grant.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationLockboxGrantVerify);
    const code = await runSlipwayApplicationLockboxGrantVerify({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      grantId: args.grant_id,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
