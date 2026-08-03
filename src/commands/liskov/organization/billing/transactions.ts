import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayOrganizationTransactions } from "../../../../session.js";

export default class LiskovOrganizationBillingTransactions extends OrganizationScopedCommand {
  static args = {
    org_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false })
  };
  static description = "List organization billing transactions.";
  static flags: Interfaces.FlagInput = {
    before: Flags.integer({ min: 0, description: "Return transactions created before this Unix time in milliseconds." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the raw Liskov JSON response." }),
    limit: Flags.integer({ min: 1, max: 500, description: "Maximum number of transactions to return." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "List Liskov organization billing transactions.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovOrganizationBillingTransactions);
    const code = await runSlipwayOrganizationTransactions({
      organizationId: args.org_id,
      beforeMs: flags.before as number | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      limit: flags.limit as number | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
