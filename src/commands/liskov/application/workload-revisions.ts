import { Args, Flags, type Interfaces } from "@oclif/core";

import { OrganizationScopedCommand, liskovUrlFlag } from "../../../organization-context.js";
import { runWorkloadRevisions } from "../../../workload-revisions.js";

export default class LiskovApplicationWorkloadRevisions extends OrganizationScopedCommand {
  static args = {
    application_id: Args.string({ description: "Liskov Application ID.", required: true })
  };
  static baseFlags: Interfaces.FlagInput = {
    ...OrganizationScopedCommand.baseFlags,
    // This command sends only reads, including when the caller omits the flag.
    "no-analytics": { ...OrganizationScopedCommand.baseFlags["no-analytics"], default: true }
  };
  static description = "Read registered provider artifacts and the desired, staged, and serving workload revision status reported by Liskov.";
  static examples = [
    "<%= config.bin %> liskov application workload-revisions proof-docs",
    "<%= config.bin %> liskov application workload-revisions proof-docs --organization example-team --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag()
  };
  static summary = "Read observed workload revisions for a Liskov Application.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationWorkloadRevisions);
    const code = await runWorkloadRevisions({
      applicationId: args.application_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
