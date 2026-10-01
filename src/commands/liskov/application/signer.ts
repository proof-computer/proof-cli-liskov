import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayApplicationSigner } from "../../../session.js";

export default class SlipwayApplicationSigner extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  // Hidden until V6 is released: `BKLG-20260907-ie6x` un-hides and documents it.
  static hidden = true;
  static description = "Show an application's self-custody signer as the server observed it: the policy it is paired against, each signer's liveness, open sign requests, terminal counts and dispatch lag. Observed (executed) funding is reported as unavailable with the server's reason, never as a figure.";
  static examples = [
    "<%= config.bin %> liskov application signer my-app",
    "<%= config.bin %> liskov application signer my-app --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Show an application's self-custody signer.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationSigner);
    const code = await runSlipwayApplicationSigner({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
