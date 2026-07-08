import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationSecrets } from "../../../session.js";

export default class SlipwayApplicationSecrets extends Command {
  static args = {
    application_id: Args.string({ description: "Liskov Application id.", required: true })
  };
  static description =
    "Read the managed secrets an Application's active policy requires, and whether each is present. Values are never shown.";
  static examples = [
    "<%= config.bin %> liskov application secrets proof-docs",
    "<%= config.bin %> liskov application secrets proof-docs --json",
    "<%= config.bin %> liskov application secrets proof-docs --slipway-url https://slipway.proof.computer"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Read Liskov Application secret requirements.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationSecrets);
    const code = await runSlipwayApplicationSecrets({
      applicationId: args.application_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
