import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshOperatorKeyRemove } from "../../../../runtime-ssh.js";

export default class RuntimeSshOperatorKeyRemove extends OrganizationScopedCommand {
  static args = {
    organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }),
    key_id: Args.string({ description: "Exact operator key ID from `operator-key list`.", required: false })
  };
  static description = "Remove an operator key from the organization registry. This is inventory hygiene, not revocation: deployed policies keep the keys they already list, so update each policy's authorizedKeys and redeploy to actually withdraw access.";
  static examples = [
    "<%= config.bin %> liskov runtime-ssh operator-key remove key_123",
    "<%= config.bin %> liskov runtime-ssh operator-key remove org_123 key_123"
  ];
  static flags: Interfaces.FlagInput = commonFlags();
  static summary = "Remove a Runtime SSH operator key from the registry.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshOperatorKeyRemove);
    const code = await runRuntimeSshOperatorKeyRemove({
      // Accepts `<org> <key>` or a bare `<key>`, matching the integration family.
      organizationId: args.key_id === undefined ? undefined : args.organization_id,
      keyId: args.key_id ?? args.organization_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}

function commonFlags(): Interfaces.FlagInput {
  return {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
}
