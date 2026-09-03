import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshWithdrawnKeyAdd } from "../../../../runtime-ssh.js";

export default class RuntimeSshWithdrawnKeyAdd extends OrganizationScopedCommand {
  static args = { organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }) };
  // For a key that IS in the registry, `operator-key remove` does both in one
  // call. This verb exists for a V4 application, whose authorized keys live in
  // the published policy and may have no registry row at all -- that operator
  // still has to be offboardable without a redeploy (BKLG-20260805-awz6).
  static description = "Withdraw one operator key's managed Runtime SSH access without republishing any policy. New connection requests and tickets are refused for the fingerprint and its unused tickets are revoked; a session already open drains. Use this for a V4 policy-inline key; for a registered key, `operator-key remove` withdraws it as part of removing it.";
  static examples = [
    "<%= config.bin %> liskov runtime-ssh withdrawn-key add --fingerprint SHA256:abc... --reason 'left the team'",
    "<%= config.bin %> liskov runtime-ssh withdrawn-key add --identity ~/.ssh/id_ed25519"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    fingerprint: Flags.string({ description: "SHA256: fingerprint of the key to withdraw." }),
    help: Flags.help({ char: "h" }),
    identity: Flags.string({ description: "Private-key path whose public half names the key instead." }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    reason: Flags.string({ description: "Why, recorded on the withdrawal and in the activity feed." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Withdraw a Runtime SSH operator key's access.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshWithdrawnKeyAdd);
    const code = await runRuntimeSshWithdrawnKeyAdd({
      organizationId: args.organization_id as string | undefined,
      fingerprint: flags.fingerprint as string | undefined,
      identity: flags.identity as string | undefined,
      reason: flags.reason as string | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
