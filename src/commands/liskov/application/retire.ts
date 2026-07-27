import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationRetirement } from "../../../session.js";

export default class SlipwayApplicationRetire extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Preview, inspect, or start safe Liskov Application retirement.";
  static examples = [
    "<%= config.bin %> liskov application retire proof-docs",
    "<%= config.bin %> liskov application retire proof-docs --reason \"project complete\" --yes",
    "<%= config.bin %> liskov application retire app-0123456789abcdef --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the canonical machine-readable retirement response." }),
    reason: Flags.string({ description: "Optional retirement reason (maximum 500 characters)." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Pause the Application and start retirement. Without this flag the command is read only." })
  };
  static summary = "Read or start safe Liskov Application retirement.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationRetire);
    const code = await runSlipwayApplicationRetirement({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
