import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshAttachmentRevoke } from "../../../../runtime-ssh.js";

export default class RuntimeSshAttachmentRevoke extends OrganizationScopedCommand {
  static args = {
    organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }),
    attachment_id: Args.string({ description: "Exact attachment ID from `attachment list`.", required: false })
  };
  // The blast radius is the difference from `withdrawn-key add`: that denies
  // one person everywhere, this ends one job's access for everyone on it.
  // Neither touches the customer's job (BKLG-20260903-suie).
  static description = "Cut access to one Runtime SSH attachment on purpose, without ending the job. No new connection request, ticket or connector registration is granted for it, and its unused tickets are revoked. A session already open drains: there is no channel that cuts an established relay, so it ends when the operator disconnects, when the job ends, or at the relay's two-hour maximum. The customer's process, health reporting and schedule are unaffected. To deny one person across every job instead, use `withdrawn-key add`.";
  static examples = [
    "<%= config.bin %> liskov runtime-ssh attachment revoke att_1a2b3c",
    "<%= config.bin %> liskov runtime-ssh attachment revoke my-org att_1a2b3c --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Revoke one Runtime SSH attachment.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshAttachmentRevoke);
    const code = await runRuntimeSshAttachmentRevoke({
      // Accepts `<org> <attachment>` or a bare `<attachment>`, matching the
      // operator-key and withdrawn-key families.
      organizationId: args.attachment_id === undefined ? undefined : args.organization_id,
      attachmentId: args.attachment_id ?? args.organization_id,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
