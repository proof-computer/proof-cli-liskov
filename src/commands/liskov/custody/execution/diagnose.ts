import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayCustodyExecutionDiagnose } from "../../../../session.js";

export default class SlipwayCustodyExecutionDiagnose extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Diagnose a live custody Acurast execution from Liskov.";
  static examples = [
    "<%= config.bin %> liskov custody execution diagnose proof-docs --execution-id live-execution:abc --network mainnet --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "execution-id": Flags.string({ description: "Live custody execution id.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    network: Flags.string({ description: "Acurast network.", options: ["mainnet", "testnet", "canary"] }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Diagnose a live custody execution.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionDiagnose);
    const code = await runSlipwayCustodyExecutionDiagnose({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      executionId: flags["execution-id"] as string,
      json: flags.json as boolean | undefined,
      network: flags.network as never,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
