import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationDelete } from "../../../session.js";

export default class SlipwayApplicationDelete extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Tombstone a Liskov Application.";
  static examples = [
    "<%= config.bin %> liskov application delete proof-docs",
    "<%= config.bin %> liskov application delete app-0123456789abcdef --reason retired --yes",
    "<%= config.bin %> liskov application delete proof-docs --force --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    force: Flags.boolean({ description: "Allow tombstoning active/current Applications." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    owner: Flags.string({ description: "Owner address to disambiguate a legacy Application id." }),
    reason: Flags.string({ description: "Deletion reason recorded on the tombstone." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the tombstone mutation. Without this flag the server returns a dry run." })
  };
  static summary = "Tombstone a Liskov Application.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationDelete);
    const code = await runSlipwayApplicationDelete({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      force: flags.force as boolean | undefined,
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
