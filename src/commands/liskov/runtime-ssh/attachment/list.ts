import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runRuntimeSshAttachmentList } from "../../../../runtime-ssh.js";

export default class RuntimeSshAttachmentList extends OrganizationScopedCommand {
  static args = { organization_id: Args.string({ description: "Exact Liskov organization ID or slug.", required: false }) };
  static description = "List this organization's Runtime SSH attachments, newest first. An attachment is one job's access: the columns are its id, readiness, provider, application, job and, when it is not usable, the reason. Use the id with `attachment revoke` to cut access to that one job.";
  static examples = [
    "<%= config.bin %> liskov runtime-ssh attachment list",
    "<%= config.bin %> liskov runtime-ssh attachment list --include-terminal --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    "include-terminal": Flags.boolean({ description: "Include attachments that have already stopped." }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "List Runtime SSH attachments.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RuntimeSshAttachmentList);
    const code = await runRuntimeSshAttachmentList({
      organizationId: args.organization_id as string | undefined,
      includeTerminal: flags["include-terminal"] as boolean | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
