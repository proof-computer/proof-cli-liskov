import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationRename } from "../../../session.js";

export default class SlipwayApplicationRename extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }),
    display_name: Args.string({ description: "New human display name for the Application.", required: true })
  };
  static description = "Change a Liskov Application's display name without changing its identity or policy.";
  static examples = [
    "<%= config.bin %> liskov application rename slipway-diagnostic 'Liskov Diagnostic'",
    "<%= config.bin %> liskov application rename slipway-diagnostic 'Liskov Diagnostic' --yes",
    "<%= config.bin %> liskov application rename app-0123456789abcdef 'Liskov Diagnostic' --owner github:12345 --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    owner: Flags.string({ description: "Owner address to disambiguate a legacy Application id." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the rename. Without this flag the server returns a dry run." })
  };
  static summary = "Change a Liskov Application's display name.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationRename);
    const code = await runSlipwayApplicationRename({
      applicationRef: args.app_ref,
      displayName: args.display_name,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      owner: flags.owner as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
