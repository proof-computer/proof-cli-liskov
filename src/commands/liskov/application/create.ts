import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayApplicationCreate } from "../../../session.js";

export default class SlipwayApplicationCreate extends OrganizationScopedCommand {
  static args = {
    application_id: Args.string({
      description: "New Liskov Application id (lowercase letters, numbers, dots, underscores, dashes).",
      required: true
    })
  };
  static description =
    "Create a Liskov Application from identity alone — no manifest of any schema version. " +
    "Policy arrives later through a publication lane (V5 documents publish via policy versions; " +
    "V4 callers keep `application import`). GitHub App sessions must pass --repository.";
  static examples = [
    "<%= config.bin %> liskov application create shard-worker",
    "<%= config.bin %> liskov application create shard-worker --display-name 'Shard Worker'",
    "<%= config.bin %> liskov application create shard-worker --repository proof-computer/shard-worker --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "display-name": Flags.string({ description: "Human display name for the Application." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    repository: Flags.string({
      description: "GitHub owner/name backing the Application (required for GitHub App sessions)."
    }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Create a Liskov Application from identity alone.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationCreate);
    const code = await runSlipwayApplicationCreate({
      applicationId: args.application_id,
      displayName: flags["display-name"] as string | undefined,
      repository: flags.repository as string | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line: string) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
