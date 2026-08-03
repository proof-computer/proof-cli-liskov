import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshIntegrationCreate } from "../../../../runtime-ssh.js";

export default class RuntimeSshIntegrationCreate extends OrganizationScopedCommand {
  static args = { organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }) };
  static description = "Connect your Tailscale account/tailnet. The OAuth secret is read from stdin or a protected prompt.";
  static examples = [
    "printf '%s\\n' \"$TAILSCALE_OAUTH_SECRET\" | <%= config.bin %> liskov runtime-ssh integration create org_123 --name 'Production tailnet' --tailnet example.com --tag tag:liskov-runtime --oauth-client-id client-id"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    name: Flags.string({ description: "Integration display name.", required: true }),
    "oauth-client-id": Flags.string({ description: "Customer-owned Tailscale OAuth client id.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    tag: Flags.string({ description: "Dedicated customer-owned Tailscale tag.", default: "tag:liskov-runtime" }),
    tailnet: Flags.string({ description: "Customer-owned Tailscale tailnet.", required: true })
  };
  static summary = "Create a BYO Tailscale Runtime SSH integration.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshIntegrationCreate);
    const code = await runRuntimeSshIntegrationCreate({
      organizationId: args.organization_id,
      name: flags.name as string,
      tailnet: flags.tailnet as string,
      tag: flags.tag as string,
      oauthClientId: flags["oauth-client-id"] as string,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
