import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayWhoami } from "../../session.js";

export default class SlipwayWhoami extends Command {
  static description = "Read the current Liskov CLI session.";
  static examples = [
    "<%= config.bin %> liskov whoami",
    "<%= config.bin %> liskov whoami --json",
    "<%= config.bin %> liskov whoami --slipway-url https://slipway.proof.computer"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Read the current Liskov CLI session.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayWhoami);
    const code = await runSlipwayWhoami({
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
