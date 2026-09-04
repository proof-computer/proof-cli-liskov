import { Args, Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationSourceBindingRevoke } from "../../../../session.js";

export default class LiskovApplicationSourceBindingRevoke extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description =
    "Revoke the current Application source binding, advancing the revocation epoch. A later set must name that revision. Requires an organization admin with application.source_binding.manage.";
  static examples = [
    "<%= config.bin %> liskov application source-binding revoke proof-docs --expected-revision 1 --reason 'credential exposure' --yes",
    "<%= config.bin %> liskov application source-binding revoke proof-docs --expected-revision 1 --reason 'credential exposure' --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "expected-revision": Flags.integer({
      description: "Revision the administrator read before revoking.",
      min: 0,
      required: true
    }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag(),
    reason: Flags.string({ description: "Reason recorded on the revocation revision.", required: true }),
    yes: Flags.boolean({ char: "y", description: "Confirm the source-binding revocation.", required: true })
  };
  static summary = "Revoke the Application source binding.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationSourceBindingRevoke);
    const code = await runSlipwayApplicationSourceBindingRevoke({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      expectedRevision: flags["expected-revision"] as number,
      json: flags.json as boolean | undefined,
      reason: flags.reason as string,
      slipwayUrl: flags["liskov-url"] as string | undefined,
      yes: flags.yes as boolean
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
