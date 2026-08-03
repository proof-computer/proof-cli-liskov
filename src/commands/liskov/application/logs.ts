import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationLogs } from "../../../session.js";

export default class LiskovApplicationLogs extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Read recent managed logs for a Liskov Application.";
  static examples = [
    "<%= config.bin %> liskov application logs proof-docs",
    "<%= config.bin %> liskov application logs proof-docs --limit 50 --origin runtime-ssh",
    "<%= config.bin %> liskov application logs proof-docs --deployment dep-123 --job job-123 --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    deployment: Flags.string({ description: "Return logs for this deployment id." }),
    help: Flags.help({ char: "h" }),
    job: Flags.string({ description: "Return logs for this job id." }),
    json: Flags.boolean({ description: "Emit the core Liskov /logs response unchanged." }),
    limit: Flags.integer({ min: 1, max: 500, description: "Maximum number of log records to return." }),
    origin: Flags.option({ options: ["all", "customer", "runtime-ssh"] as const, description: "Filter by product log origin." })(),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Read recent Liskov Application logs.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationLogs);
    const code = await runSlipwayApplicationLogs({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      deploymentId: flags.deployment as string | undefined,
      jobId: flags.job as string | undefined,
      json: flags.json as boolean | undefined,
      limit: flags.limit as number | undefined,
      origin: flags.origin as "all" | "customer" | "runtime-ssh" | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
