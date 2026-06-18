import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationBackfillIdentities } from "../../../session.js";

export default class SlipwayApplicationBackfillIdentities extends Command {
  static description = "Backfill Liskov Application identity fields.";
  static examples = [
    "<%= config.bin %> liskov application backfill-identities",
    "<%= config.bin %> liskov application backfill-identities --yes",
    "<%= config.bin %> liskov application backfill-identities --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the identity backfill mutation. Without this flag the server returns a dry run." })
  };
  static summary = "Backfill Liskov Application identity fields.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayApplicationBackfillIdentities);
    const code = await runSlipwayApplicationBackfillIdentities({
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
