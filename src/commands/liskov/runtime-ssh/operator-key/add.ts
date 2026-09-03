import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshOperatorKeyAdd } from "../../../../runtime-ssh.js";

export default class RuntimeSshOperatorKeyAdd extends OrganizationScopedCommand {
  static args = { organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }) };
  static description = "Register an ssh-ed25519 operator public key for managed Runtime SSH. Only the public key is sent. Registering a key authorizes new attachments, not existing ones: a V5 application snapshots this registry when its next attachment is created, and a V4 application must also list the key in its policy's ingress.ssh.provider.authorizedKeys.";
  static examples = [
    "<%= config.bin %> liskov runtime-ssh operator-key add org_123 --name patrick-mbp --identity ~/.ssh/id_ed25519",
    "<%= config.bin %> liskov runtime-ssh operator-key add org_123 --name ci-break-glass --public-key-file ./ci.pub",
    "cat ci.pub | <%= config.bin %> liskov runtime-ssh operator-key add org_123 --name ci-break-glass --public-key-file -"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    identity: Flags.string({ description: "Ed25519 private-key path whose public half is registered (the same flag liskov ssh uses).", exactlyOne: ["identity", "public-key-file"] }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    name: Flags.string({ description: "Operator key display name, unique within the organization.", required: true }),
    "public-key-file": Flags.string({ description: "Public-key file to register, or - to read it from stdin.", exactlyOne: ["identity", "public-key-file"] }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Register a managed Runtime SSH operator key.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshOperatorKeyAdd);
    const code = await runRuntimeSshOperatorKeyAdd({
      organizationId: args.organization_id,
      name: flags.name as string,
      identity: flags.identity as string | undefined,
      publicKeyFile: flags["public-key-file"] as string | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
