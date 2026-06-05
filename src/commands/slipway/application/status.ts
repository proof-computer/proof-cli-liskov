import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationStatus } from "../../../session.js";

export default class SlipwayApplicationStatus extends Command {
  static args = {
    application_id: Args.string({ description: "Slipway Application id.", required: true })
  };
  static description = "Read Slipway Application status.";
  static examples = [
    "<%= config.bin %> slipway application status proof-docs",
    "<%= config.bin %> slipway application status proof-docs --json",
    "<%= config.bin %> slipway application status proof-docs --slipway-url https://slipway.proof.computer"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." })
  };
  static summary = "Read Slipway Application status.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationStatus);
    const code = await runSlipwayApplicationStatus({
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
