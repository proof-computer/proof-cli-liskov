import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshWithdrawnKeyList } from "../../../../runtime-ssh.js";

export default class RuntimeSshWithdrawnKeyList extends OrganizationScopedCommand {
  static args = { organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }) };
  static description = "List the operator-key fingerprints whose managed Runtime SSH access is withdrawn for this organization. A withdrawn fingerprint may still appear in an existing attachment's snapshot: the snapshot is immutable, and the withdrawal is what denies it.";
  static examples = ["<%= config.bin %> liskov runtime-ssh withdrawn-key list --json"];
  static flags: Interfaces.FlagInput = commonFlags();
  static summary = "List withdrawn Runtime SSH operator keys.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshWithdrawnKeyList);
    const code = await runRuntimeSshWithdrawnKeyList({
      organizationId: args.organization_id as string | undefined,
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
