import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayAdminProcessorList } from "../../../../session.js";

export default class SlipwayAdminProcessorList extends Command {
  static description = "List Liskov processors and their greylist state.";
  static examples = [
    "<%= config.bin %> liskov admin processor list --json",
    "<%= config.bin %> liskov admin processor list --greylisted"
  ];
  static flags: Interfaces.FlagInput = {
    "admin-token": Flags.string({ description: "Admin service token (else PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN, else session token)." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    greylisted: Flags.boolean({ description: "Only return greylisted processors." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "List Liskov processors and their greylist state.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayAdminProcessorList);
    const code = await runSlipwayAdminProcessorList({
      adminToken: flags["admin-token"] as string | undefined,
      config: flags.config as string | undefined,
      greylisted: flags.greylisted as boolean | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
