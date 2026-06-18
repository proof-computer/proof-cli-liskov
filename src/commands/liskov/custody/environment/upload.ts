import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyEnvironmentUpload } from "../../../../session.js";

export default class SlipwayCustodyEnvironmentUpload extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Build and upload encrypted Acurast environment handoffs.";
  static examples = [
    "<%= config.bin %> liskov custody environment upload proof-docs --secrets-file .env.local --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    network: Flags.string({ description: "Acurast network.", options: ["mainnet", "testnet", "canary"] }),
    "repo-dir": Flags.string({ description: "Repository directory for future local action providers." }),
    "rpc-url": Flags.string({ description: "Acurast RPC URL for assignment-key reads." }),
    "secrets-file": Flags.string({ description: "Local dotenv file containing environment values.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm encrypted handoff upload." })
  };
  static summary = "Upload encrypted environment handoffs.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyEnvironmentUpload);
    const code = await runSlipwayCustodyEnvironmentUpload({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      network: flags.network as never,
      repoDir: flags["repo-dir"] as string | undefined,
      rpcUrl: flags["rpc-url"] as string | undefined,
      secretsFile: flags["secrets-file"] as string,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
