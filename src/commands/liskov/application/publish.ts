import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationPublish } from "../../../session.js";

export default class SlipwayApplicationPublish extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Publish the current Liskov Application draft.";
  static examples = [
    "<%= config.bin %> liskov application publish proof-docs --yes",
    "<%= config.bin %> liskov application publish proof-docs --paused --reason \"failure-matrix initialization\" --yes",
    "<%= config.bin %> liskov application publish proof-docs --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    paused: Flags.boolean({ description: "Atomically leave the Application paused after publication." }),
    reason: Flags.string({ description: "Required operator reason when --paused is used." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the publish mutation." })
  };
  static summary = "Publish the current Liskov Application draft.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationPublish);
    const code = await runSlipwayApplicationPublish({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      paused: flags.paused as boolean | undefined,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
