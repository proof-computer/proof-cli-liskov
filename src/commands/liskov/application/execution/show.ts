import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationExecutionShow } from "../../../../session.js";

export default class LiskovApplicationExecutionShow extends OrganizationScopedCommand {
  static args = {
    application_id: Args.string({ description: "Liskov Application id.", required: true })
  };
  static description =
    "Render the application's typed-spine execution — occurrence, attempt, effects, receipts, spend lineage, blocker and decision trace — from the canonical policy explanation envelope. Nothing is inferred locally; --watch reports one record per semantic change.";
  static examples = [
    "<%= config.bin %> liskov application execution show proof-docs",
    "<%= config.bin %> liskov application execution show proof-docs --json",
    "<%= config.bin %> liskov application execution show proof-docs --watch --timeout-seconds 900",
    "<%= config.bin %> liskov application execution show proof-docs --watch --json --poll-ms 1000"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the verbatim server envelope (NDJSON change records with --watch)." }),
    "poll-ms": Flags.integer({ description: "Watch poll interval in milliseconds (minimum 500).", min: 500 }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    "timeout-seconds": Flags.integer({ description: "Stop watching after this many seconds (maximum 1800).", min: 1, max: 1800 }),
    "until-terminal": Flags.boolean({ description: "Keep watching through a persisted blocker until the occurrence reaches a terminal state." }),
    watch: Flags.boolean({ description: "Re-read the envelope and print one line per semantic change until terminal, blocked, or timed out." })
  };
  static summary = "Show the typed-spine execution of an Application.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationExecutionShow);
    const code = await runSlipwayApplicationExecutionShow({
      applicationId: args.application_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      pollMs: flags["poll-ms"] as number | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      timeoutSeconds: flags["timeout-seconds"] as number | undefined,
      untilTerminal: flags["until-terminal"] as boolean | undefined,
      watch: flags.watch as boolean | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line),
      stderr: (line) => this.warn(line)
    });
    if (code !== 0) this.exit(code);
  }
}
