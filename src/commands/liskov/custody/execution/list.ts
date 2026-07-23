import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionList } from "../../../../session.js";

export default class SlipwayCustodyExecutionList extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "List Liskov live custody executions.";
  static examples = [
    "<%= config.bin %> liskov custody execution list proof-docs --json",
    "<%= config.bin %> liskov custody execution list proof-docs --status submitted --status observed --limit 25"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    limit: Flags.integer({ min: 0, description: "Maximum number of executions to return." }),
    offset: Flags.integer({ min: 0, description: "Number of matching executions to skip." }),
    reason: Flags.string({ multiple: true, description: "Filter by reason; repeat to match more than one reason." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    status: Flags.string({ multiple: true, description: "Filter by status; repeat to match more than one status." })
  };
  static summary = "List live custody executions.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionList);
    const code = await runSlipwayCustodyExecutionList({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      limit: flags.limit as number | undefined,
      offset: flags.offset as number | undefined,
      reasons: flags.reason as string[] | undefined,
      statuses: flags.status as string[] | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
