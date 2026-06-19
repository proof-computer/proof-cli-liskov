import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationActivity } from "../../../session.js";

export default class SlipwayApplicationActivity extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Read the Liskov Application activity feed.";
  static examples = [
    "<%= config.bin %> liskov application activity proof-docs --json",
    "<%= config.bin %> liskov application activity proof-docs --limit 50 --before 1718700000000"
  ];
  static flags: Interfaces.FlagInput = {
    before: Flags.integer({ description: "Only return events before this epoch millisecond timestamp." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    limit: Flags.integer({ description: "Maximum number of activity events to return." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Read the Liskov Application activity feed.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationActivity);
    const code = await runSlipwayApplicationActivity({
      applicationRef: args.app_ref,
      before: flags.before as number | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      limit: flags.limit as number | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
