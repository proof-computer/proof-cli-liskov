import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand, liskovUrlFlag } from "../../../organization-context.js";
import { runSlipwayApplicationPlacementPlan } from "../../../session.js";

export default class LiskovApplicationPlacementPlan extends OrganizationScopedCommand {
  static args = {
    application_id: Args.string({ description: "Liskov Application identity.", required: true }),
    occurrence_authority_digest: Args.string({ description: "Exact occurrence authority digest.", required: true })
  };
  // BKLG-20260907-ie6x alone promotes V6 availability.
  static hidden = true;
  static summary = "Read an immutable initial placement feasibility snapshot.";
  static description = "Read the initial whole-application spread plan for an explicit occurrence. Counts describe the original plan and carry no current fulfillment guarantee.";
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the owner response unchanged as JSON." }),
    "liskov-url": liskovUrlFlag()
  };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationPlacementPlan);
    const code = await runSlipwayApplicationPlacementPlan({
      applicationId: args.application_id,
      occurrenceAuthorityDigest: args.occurrence_authority_digest,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
