import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshWithdrawnKeyRemove } from "../../../../runtime-ssh.js";

export default class RuntimeSshWithdrawnKeyRemove extends OrganizationScopedCommand {
  static args = {
    organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }),
    withdrawal_id: Args.string({ description: "Exact withdrawal ID from `withdrawn-key list`.", required: false })
  };
  static description = "Lift a withdrawal, so the key can be authorized again. This does not re-register the key: a V5 application must still have it in the operator-key registry when its next attachment is created, and a V4 application must still list it in the published policy.";
  static examples = ["<%= config.bin %> liskov runtime-ssh withdrawn-key remove rsw_123"];
  static flags: Interfaces.FlagInput = commonFlags();
  static summary = "Lift a Runtime SSH operator-key withdrawal.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshWithdrawnKeyRemove);
    const code = await runRuntimeSshWithdrawnKeyRemove({
      // Accepts `<org> <withdrawal>` or a bare `<withdrawal>`, matching the
      // operator-key family.
      organizationId: args.withdrawal_id === undefined ? undefined : args.organization_id,
      withdrawalId: args.withdrawal_id ?? args.organization_id,
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
