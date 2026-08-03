import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshIntegrationRotate } from "../../../../runtime-ssh.js";

export default class RuntimeSshIntegrationRotate extends OrganizationScopedCommand {
  static args = {
    organization_id: Args.string({ description: "Organization selector when an integration ID follows; otherwise the integration ID.", required: false }),
    integration_id: Args.string({ description: "Runtime SSH integration id.", required: false })
  };
  static description = "Rotate customer-owned Tailscale OAuth credentials. The secret is read from stdin or a protected prompt.";
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "oauth-client-id": Flags.string({ description: "New customer-owned Tailscale OAuth client id.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Rotate a BYO Tailscale integration credential.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshIntegrationRotate);
    const code = await runRuntimeSshIntegrationRotate({
      organizationId: args.integration_id === undefined ? undefined : args.organization_id,
      integrationId: args.integration_id ?? args.organization_id,
      oauthClientId: flags["oauth-client-id"] as string,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
