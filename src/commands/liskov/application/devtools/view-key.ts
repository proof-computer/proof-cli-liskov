import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationDevtoolsViewKey } from "../../../../session.js";

export default class SlipwayApplicationDevtoolsViewKey extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }),
    deployment_id: Args.string({ description: "Acurast deployment id recorded for the Application.", required: true })
  };
  static description = "Mint a short-lived Acurast DevTools view key for a Liskov deployment.";
  static examples = [
    "<%= config.bin %> liskov application devtools view-key proof-docs 66059",
    "<%= config.bin %> liskov application devtools view-key proof-docs 66059 --json",
    "<%= config.bin %> liskov application devtools view-key proof-docs 66059 --account-ref live-custody:owner/repo:acurast"
  ];
  static flags: Interfaces.FlagInput = {
    "account-ref": Flags.string({ description: "Override the live-custody account ref used for signing." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Mint an Acurast DevTools view key.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationDevtoolsViewKey);
    const code = await runSlipwayApplicationDevtoolsViewKey({
      accountRef: flags["account-ref"] as string | undefined,
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      deploymentId: args.deployment_id,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
