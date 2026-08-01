import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runRuntimeSshIntegrationList } from "../../../../runtime-ssh.js";

export default class RuntimeSshIntegrationList extends Command {
  static args = { organization_id: Args.string({ description: "Liskov organization id.", required: true }) };
  static description = "List customer-owned Tailscale integrations for a Liskov organization.";
  static flags: Interfaces.FlagInput = commonFlags();
  static summary = "List Runtime SSH integrations.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshIntegrationList);
    const code = await runRuntimeSshIntegrationList({
      organizationId: args.organization_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
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
