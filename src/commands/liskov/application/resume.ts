import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationStatusTransition } from "../../../session.js";

export default class SlipwayApplicationResume extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Resume new Liskov work for a paused Application.";
  static examples = [
    "<%= config.bin %> liskov application resume proof-docs",
    "<%= config.bin %> liskov application resume proof-docs --reason \"funded\" --yes",
    "<%= config.bin %> liskov application resume switchboard-pitchdeck-acurast --override-replacement-hold --reason \"operator reviewed dossier\" --yes",
    "<%= config.bin %> liskov application resume app-0123456789abcdef --owner github:12345 --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    owner: Flags.string({ description: "Owner address to disambiguate a legacy Application id." }),
    "override-replacement-hold": Flags.boolean({ description: "Explicitly override a replacement-spend hold when paired with --reason and --yes." }),
    reason: Flags.string({ description: "Resume reason recorded on the Application." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the resume mutation. Without this flag the server returns a dry run." })
  };
  static summary = "Resume new Liskov work for a paused Application.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationResume);
    const code = await runSlipwayApplicationStatusTransition({
      applicationRef: args.app_ref,
      status: "active",
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      owner: flags.owner as string | undefined,
      overrideReplacementHold: flags["override-replacement-hold"] as boolean | undefined,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
