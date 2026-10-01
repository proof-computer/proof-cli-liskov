import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayPlacementManagerFleet } from "../../../session.js";

export default class SlipwayPlacementManagerFleet extends OrganizationScopedCommand {
  static args = {
    manager_id: Args.string({ description: "The processor manager id as it appears on chain and in `deployment.placement` rules.", required: true })
  };
  // Hidden until V6 is released: `BKLG-20260907-ie6x` un-hides and documents it.
  static hidden = true;
  static description = "Count the processors a manager rule in a manifest's `deployment.placement` would reach: how many eligible processors the served placement projection knows under the manager, how many a filtered placement reaches now, which projection answered and how old the manager evidence is. No processor is listed. When no projection can answer, the count is unavailable, not zero.";
  static examples = [
    "<%= config.bin %> liskov placement manager-fleet 9470",
    "<%= config.bin %> liskov placement manager-fleet 9470 --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Count the processors a manager placement rule reaches.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayPlacementManagerFleet);
    const code = await runSlipwayPlacementManagerFleet({
      managerId: args.manager_id as string,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
