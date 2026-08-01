import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runRuntimeSshIntegrationDisable } from "../../../../runtime-ssh.js";

export default class RuntimeSshIntegrationDisable extends Command {
  static args = {
    organization_id: Args.string({ description: "Liskov organization id.", required: true }),
    integration_id: Args.string({ description: "Runtime SSH integration id.", required: true })
  };
  static description = "Disable a Runtime SSH integration and tear down its exact live attachments.";
  static flags: Interfaces.FlagInput = commonFlags();
  static summary = "Disable a BYO Tailscale integration.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshIntegrationDisable);
    const code = await runRuntimeSshIntegrationDisable({
      organizationId: args.organization_id,
      integrationId: args.integration_id,
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
