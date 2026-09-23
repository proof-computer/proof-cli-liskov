import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshAttachmentEndpoints } from "../../../../runtime-ssh.js";

export default class RuntimeSshAttachmentEndpoints extends OrganizationScopedCommand {
  static args = {
    app: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }),
    attachment_id: Args.string({ description: "Exact attachment ID from `attachment list`.", required: false })
  };
  // Hidden until V6 is released: `BKLG-20260907-ie6x` un-hides and documents it.
  static hidden = true;
  static description = "Show the private endpoints one Runtime SSH attachment publishes, as the server observed them. The columns are the use site, service, local port, state, address and, when degraded, the reason. The state is the only readiness fact: a published endpoint has an address but has not been observed ready.";
  static examples = [
    "<%= config.bin %> liskov runtime-ssh attachment endpoints my-app att_1a2b3c",
    "<%= config.bin %> liskov runtime-ssh attachment endpoints my-app att_1a2b3c --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Show a Runtime SSH attachment's private endpoints.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshAttachmentEndpoints);
    const code = await runRuntimeSshAttachmentEndpoints({
      applicationRef: args.app as string,
      attachmentId: args.attachment_id as string | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
