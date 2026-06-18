import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationList } from "../../../session.js";

export default class SlipwayApplicationList extends Command {
  static description = "List readable Liskov Applications.";
  static examples = [
    "<%= config.bin %> liskov application list",
    "<%= config.bin %> liskov application list --json",
    "<%= config.bin %> liskov application list --slipway-url https://slipway.proof.computer"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "List readable Liskov Applications.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayApplicationList);
    const code = await runSlipwayApplicationList({
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
