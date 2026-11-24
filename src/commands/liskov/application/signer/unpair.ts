import { Args, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationSignerUnpair } from "../../../../application-signer.js";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

export default class LiskovApplicationSignerUnpair extends OrganizationScopedCommand {
  // Hidden until V6 is released: BKLG-20261123-irb3 un-hides it.
  static hidden = true;
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Remove the paired self-custody signer. Removal requires --yes and is refused while sign requests are open.";
  static examples = ["<%= config.bin %> liskov application signer unpair my-app --yes"];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag(),
    yes: Flags.boolean({ description: "Confirm removal of the paired signer." })
  };
  static summary = "Remove an application's self-custody signer.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationSignerUnpair);
    const code = await runSlipwayApplicationSignerUnpair({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
