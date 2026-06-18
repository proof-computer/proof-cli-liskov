import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationLockboxDispatch } from "../../../../session.js";

export default class SlipwayApplicationLockboxDispatch extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Dispatch the Liskov Lockbox upload workflow.";
  static examples = [
    "<%= config.bin %> liskov application lockbox dispatch proof-docs --yes",
    "<%= config.bin %> liskov application lockbox dispatch proof-docs --ref release --json --yes"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    ref: Flags.string({ description: "Git ref to dispatch." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the Lockbox workflow dispatch mutation." })
  };
  static summary = "Dispatch the Lockbox workflow.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationLockboxDispatch);
    const code = await runSlipwayApplicationLockboxDispatch({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      ref: flags.ref as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
