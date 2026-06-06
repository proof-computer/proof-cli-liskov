import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationLockboxSetupPr } from "../../../../session.js";

export default class SlipwayApplicationLockboxSetupPr extends Command {
  static args = {
    app_ref: Args.string({ description: "Slipway Application uid, name, or legacy id.", required: true })
  };
  static description = "Create or update the Slipway Lockbox setup pull request.";
  static examples = [
    "<%= config.bin %> slipway application lockbox setup-pr proof-docs --yes",
    "<%= config.bin %> slipway application lockbox setup-pr proof-docs --base-ref release --json --yes"
  ];
  static flags: Interfaces.FlagInput = {
    "base-ref": Flags.string({ description: "Base Git ref for the setup pull request." }),
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the Lockbox setup PR mutation." })
  };
  static summary = "Create the Lockbox setup pull request.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationLockboxSetupPr);
    const code = await runSlipwayApplicationLockboxSetupPr({
      applicationRef: args.app_ref,
      baseRef: flags["base-ref"] as string | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
