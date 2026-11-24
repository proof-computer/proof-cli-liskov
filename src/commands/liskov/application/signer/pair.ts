import { Args, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationSignerPair } from "../../../../application-signer.js";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

export default class LiskovApplicationSignerPair extends OrganizationScopedCommand {
  // Hidden until V6 is released: BKLG-20261123-irb3 un-hides it.
  static hidden = true;
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Issue a pairing token to connect or replace a self-custody signer.";
  static examples = ["<%= config.bin %> liskov application signer pair my-app"];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag()
  };
  static summary = "Issue an application's self-custody signer pairing token.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationSignerPair);
    const code = await runSlipwayApplicationSignerPair({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
