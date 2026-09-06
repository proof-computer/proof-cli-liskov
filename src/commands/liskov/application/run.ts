import { Args, Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayApplicationRun } from "../../../session.js";

export default class LiskovApplicationRun extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description =
    "Ask a settled `once` Liskov Application to run once more. Without --yes the server returns a dry run naming the jobs, the paid window and the reserve a run would open. A run authorizes one more occurrence against the Application's current published revision; it does not promise a launch, and continuous and interval Applications schedule their own occurrences.";
  static examples = [
    "<%= config.bin %> liskov application run proof-docs",
    "<%= config.bin %> liskov application run proof-docs --reason \"rerun after data fix\" --yes",
    "<%= config.bin %> liskov application run app-0123456789abcdef --owner github:12345 --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag(),
    owner: Flags.string({ description: "Owner address to disambiguate a legacy Application id." }),
    reason: Flags.string({ description: "Reason recorded on the run request." }),
    yes: Flags.boolean({ char: "y", description: "Authorize the run. Without this flag the server returns a dry run." })
  };
  static summary = "Run a settled `once` Application once more.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationRun);
    const code = await runSlipwayApplicationRun({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      owner: flags.owner as string | undefined,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
