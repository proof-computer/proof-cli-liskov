import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyMachineCatalog } from "../../../../session.js";

export default class SlipwayCustodyMachineCatalog extends Command {
  static description = "Read the server-side Acurast machine-class catalog.";
  static examples = [
    "<%= config.bin %> liskov custody machine catalog --network mainnet --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    network: Flags.string({ description: "Acurast network.", options: ["mainnet", "testnet", "canary"] }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Read Acurast machine-class catalog.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayCustodyMachineCatalog);
    const code = await runSlipwayCustodyMachineCatalog({
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      network: flags.network as never,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
