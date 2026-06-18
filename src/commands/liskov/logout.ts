import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayLogout } from "../../session.js";

export default class SlipwayLogout extends Command {
  static description = "Remove the local Liskov CLI session.";
  static examples = [
    "<%= config.bin %> liskov logout",
    "<%= config.bin %> liskov logout --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." })
  };
  static summary = "Remove the local Liskov CLI session.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayLogout);
    const code = await runSlipwayLogout({
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
