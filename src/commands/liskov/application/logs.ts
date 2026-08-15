import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayApplicationLogs } from "../../../session.js";

export default class LiskovApplicationLogs extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Read recent managed logs for a Liskov Application, stream them live, or page through the full retained history.";
  static examples = [
    "<%= config.bin %> liskov application logs proof-docs",
    "<%= config.bin %> liskov application logs proof-docs --limit 50 --origin runtime-ssh",
    "<%= config.bin %> liskov application logs proof-docs --deployment dep-123 --job job-123 --json",
    "<%= config.bin %> liskov application logs proof-docs --follow",
    "<%= config.bin %> liskov application logs proof-docs --from-start --ndjson",
    "<%= config.bin %> liskov application logs proof-docs --follow --event 'runtime.access.*'"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    deployment: Flags.string({ description: "Return logs for this deployment id." }),
    event: Flags.string({ description: "Only show records whose event matches this glob (* matches any run of characters)." }),
    follow: Flags.boolean({ description: "Stream new log records until interrupted." }),
    "from-start": Flags.boolean({ description: "Page through the full retained history oldest-first." }),
    help: Flags.help({ char: "h" }),
    job: Flags.string({ description: "Return logs for this job id." }),
    json: Flags.boolean({ description: "Emit the core Liskov /logs response unchanged." }),
    limit: Flags.integer({ min: 1, max: 500, description: "Maximum number of log records to return." }),
    ndjson: Flags.boolean({ description: "Emit one raw log record JSON object per line." }),
    origin: Flags.option({ options: ["all", "customer", "runtime-ssh", "runtime_ssh"] as const, description: "Filter by product log origin." })(),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Read recent Liskov Application logs.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationLogs);
    const origin = flags.origin as "all" | "customer" | "runtime-ssh" | "runtime_ssh" | undefined;
    const code = await runSlipwayApplicationLogs({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      deploymentId: flags.deployment as string | undefined,
      event: flags.event as string | undefined,
      follow: flags.follow as boolean | undefined,
      fromStart: flags["from-start"] as boolean | undefined,
      jobId: flags.job as string | undefined,
      json: flags.json as boolean | undefined,
      limit: flags.limit as number | undefined,
      ndjson: flags.ndjson as boolean | undefined,
      origin: origin === "runtime_ssh" ? "runtime-ssh" : origin,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line),
      stderr: (line) => process.stderr.write(`${line}\n`)
    });
    if (code !== 0) this.exit(code);
  }
}
