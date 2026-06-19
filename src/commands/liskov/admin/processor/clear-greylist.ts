import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayAdminProcessorClearGreylist } from "../../../../session.js";

export default class SlipwayAdminProcessorClearGreylist extends Command {
  static args = {
    processor_id: Args.string({ description: "Processor id to clear from the greylist.", required: true })
  };
  static description = "Clear a Liskov processor from the greylist.";
  static examples = [
    "<%= config.bin %> liskov admin processor clear-greylist 0xabc",
    "<%= config.bin %> liskov admin processor clear-greylist 0xabc --reason recovered --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    "admin-token": Flags.string({ description: "Admin service token (else PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN, else session token)." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    reason: Flags.string({ description: "Reason recorded for clearing the greylist." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the clear. Without this flag the server returns a dry run." })
  };
  static summary = "Clear a Liskov processor from the greylist.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayAdminProcessorClearGreylist);
    const code = await runSlipwayAdminProcessorClearGreylist({
      adminToken: flags["admin-token"] as string | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      processorId: args.processor_id,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
