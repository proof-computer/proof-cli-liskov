import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationArtifactPinRestore } from "../../../../session.js";

export default class SlipwayApplicationArtifactPinRestore extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }),
    pin_id: Args.string({ description: "Artifact pin id to restore.", required: true })
  };
  static description = "Restore a Liskov Application artifact pin.";
  static examples = [
    "<%= config.bin %> liskov application artifact-pin restore proof-docs pin-123",
    "<%= config.bin %> liskov application artifact-pin restore proof-docs pin-123 --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the restore. Without this flag the server returns a dry run." })
  };
  static summary = "Restore a Liskov Application artifact pin.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationArtifactPinRestore);
    const code = await runSlipwayApplicationArtifactPinRestore({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      pinId: args.pin_id,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
