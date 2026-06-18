import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionSubmit } from "../../../../session.js";

export default class SlipwayCustodyExecutionSubmit extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Submit a Liskov live custody execution.";
  static examples = [
    "<%= config.bin %> liskov custody execution submit proof-docs --plan-item-id deploy-1 --idempotency-key key-1 --yes-spend --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    "idempotency-key": Flags.string({ description: "Plan idempotency key.", required: true }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    network: Flags.string({ description: "Acurast network for optional environment handoff.", options: ["mainnet", "testnet", "canary"] }),
    "plan-item-id": Flags.string({ description: "Live custody plan item id.", required: true }),
    "repo-dir": Flags.string({ description: "Repository directory for future local action providers." }),
    "rpc-url": Flags.string({ description: "Acurast RPC URL for optional environment handoff." }),
    "secrets-file": Flags.string({ description: "Local dotenv file for setEnvironment plan items." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm execution submission." }),
    "yes-spend": Flags.boolean({ description: "Confirm live custody spend." })
  };
  static summary = "Submit a live custody execution.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionSubmit);
    const code = await runSlipwayCustodyExecutionSubmit({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      idempotencyKey: flags["idempotency-key"] as string,
      json: flags.json as boolean | undefined,
      network: flags.network as never,
      planItemId: flags["plan-item-id"] as string,
      repoDir: flags["repo-dir"] as string | undefined,
      rpcUrl: flags["rpc-url"] as string | undefined,
      secretsFile: flags["secrets-file"] as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined,
      yesSpend: flags["yes-spend"] as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
