import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand, liskovUrlFlag } from "../../../organization-context.js";
import { runSlipwayApplicationPlacementRefusals } from "../../../session.js";

export default class LiskovApplicationPlacementRefusals extends OrganizationScopedCommand {
  static args = {
    application_id: Args.string({ description: "Liskov Application identity.", required: true })
  };
  // BKLG-20260907-ie6x alone promotes V6 availability.
  static hidden = true;
  static summary = "Read one page of recorded country and spread placement refusals.";
  static description = "Read one page of an Application's recorded placement refusals in an explicit hourly window, with the server's reason and next action for each. Absent rows never mean placement succeeded: only the first refusal of each Application, code and hour is kept, a refusal whose write failed has no row, and `incomplete: false` does not mean every refusal is present. `incomplete` describes the whole page, one cut row marks all of it, and candidate counts cover only what was recorded. There is no default window and no automatic paging.";
  static examples = [
    "<%= config.bin %> liskov application placement-refusals proof-docs --from-ms 1757995200000 --to-ms 1758002400000 --limit 25",
    "<%= config.bin %> liskov application placement-refusals proof-docs --from-ms 1757995200000 --to-ms 1758002400000 --limit 25 --cursor <nextCursor> --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    cursor: Flags.string({ description: "The `nextCursor` of the previous page, sent as given. It works only with the same --from-ms and --to-ms." }),
    "from-ms": Flags.string({ description: "Earliest hourly window start to read, inclusive, in Unix milliseconds.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the owner response unchanged as JSON." }),
    limit: Flags.string({ description: "Most observations in this page, from 1 through 100.", required: true }),
    "liskov-url": liskovUrlFlag(),
    "to-ms": Flags.string({ description: "Hourly window start to stop before, exclusive, in Unix milliseconds.", required: true })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationPlacementRefusals);
    const code = await runSlipwayApplicationPlacementRefusals({
      applicationId: args.application_id,
      fromMs: flags["from-ms"] as string,
      toMs: flags["to-ms"] as string,
      limit: flags.limit as string,
      cursor: flags.cursor as string | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
