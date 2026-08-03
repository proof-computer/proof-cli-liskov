import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayOrganizationUse } from "../../../session.js";

export default class LiskovOrganizationUse extends OrganizationScopedCommand {
  static args = {
    org_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false })
  };
  static description = "Select the active organization for the current Liskov session.";
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the raw Liskov JSON response." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Use a Liskov organization.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovOrganizationUse);
    const code = await runSlipwayOrganizationUse({
      organizationId: args.org_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
