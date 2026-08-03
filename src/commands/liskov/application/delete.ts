import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayApplicationDelete } from "../../../session.js";

export default class SlipwayApplicationDelete extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Deprecated clean-only deletion bridge for a Liskov Application.";
  static examples = [
    "<%= config.bin %> liskov application delete proof-docs",
    "<%= config.bin %> liskov application delete app-0123456789abcdef --reason retired --yes",
    "<%= config.bin %> liskov application retire proof-docs --reason retired --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "acknowledge-live-resources": Flags.boolean({ description: "Deprecated compatibility flag; parsed but never bypasses retirement blockers." }),
    force: Flags.boolean({ description: "Deprecated compatibility flag; parsed but never bypasses retirement blockers." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    owner: Flags.string({ description: "Owner address to disambiguate a legacy Application id." }),
    reason: Flags.string({ description: "Deletion reason recorded only with --yes." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm clean-only deletion. Without this flag the CLI performs a read-only preview." })
  };
  static summary = "Deprecated clean-only deletion bridge; use application retire.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationDelete);
    const code = await runSlipwayApplicationDelete({
      applicationRef: args.app_ref,
      acknowledgeLiveResources: flags["acknowledge-live-resources"] as boolean | undefined,
      config: flags.config as string | undefined,
      force: flags.force as boolean | undefined,
      json: flags.json as boolean | undefined,
      owner: flags.owner as string | undefined,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
