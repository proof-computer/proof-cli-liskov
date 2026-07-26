import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayOrganizationList } from "../../../session.js";

export default class LiskovOrganizationList extends Command {
  static description = "List organizations available to the current Liskov session.";
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the raw Liskov JSON response." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "List Liskov organizations.";

  async run(): Promise<void> {
    const { flags } = await this.parse(LiskovOrganizationList);
    const code = await runSlipwayOrganizationList({
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
