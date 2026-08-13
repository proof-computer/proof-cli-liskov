import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshOperatorKeyList } from "../../../../runtime-ssh.js";

export default class RuntimeSshOperatorKeyList extends OrganizationScopedCommand {
  static args = { organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }) };
  static description = "List the managed Runtime SSH operator keys registered for a Liskov organization. The registry is an inventory: a key grants access only where an application policy lists it.";
  static flags: Interfaces.FlagInput = commonFlags();
  static summary = "List Runtime SSH operator keys.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshOperatorKeyList);
    const code = await runRuntimeSshOperatorKeyList({
      organizationId: args.organization_id,
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
