import { Args, Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationSourceBindingSet } from "../../../../session.js";

export default class LiskovApplicationSourceBindingSet extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description =
    "Create or rotate the server-owned Application source binding. Omit --expected-revision on create; a later set must name the revision from show. Requires an organization admin with application.source_binding.manage.";
  static examples = [
    "<%= config.bin %> liskov application source-binding set proof-docs --repository proof-computer/proof-docs --allowed-ref refs/heads/main --workflow-identity proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main --manifest-path .liskov/proof-docs-v5.json --yes",
    "<%= config.bin %> liskov application source-binding set proof-docs --repository proof-computer/proof-docs --allowed-ref refs/heads/main --allowed-ref refs/heads/release --workflow-identity proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main --manifest-path .liskov/proof-docs-v5.json --expected-revision 1 --reason 'rotate to release' --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    "allowed-ref": Flags.string({
      description: "Exact Git ref the binding admits (repeatable; no default).",
      multiple: true,
      required: true
    }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "expected-revision": Flags.integer({
      description: "Revision the administrator read. Omit on create; 0 means update revision 0 and conflicts.",
      min: 0
    }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag(),
    "manifest-path": Flags.string({
      description: "Safe relative path of the Application document in the repository.",
      required: true
    }),
    reason: Flags.string({ description: "Optional reason recorded on the binding revision." }),
    repository: Flags.string({ description: "GitHub owner/name the binding admits.", required: true }),
    "workflow-identity": Flags.string({
      description: "Exact GitHub workflow identity the binding admits.",
      required: true
    }),
    yes: Flags.boolean({ char: "y", description: "Confirm the source-binding mutation.", required: true })
  };
  static summary = "Create or rotate the Application source binding.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationSourceBindingSet);
    const code = await runSlipwayApplicationSourceBindingSet({
      allowedRefs: flags["allowed-ref"] as string[],
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      expectedRevision: flags["expected-revision"] as number | undefined,
      json: flags.json as boolean | undefined,
      manifestPath: flags["manifest-path"] as string,
      reason: flags.reason as string | undefined,
      repository: flags.repository as string,
      slipwayUrl: flags["liskov-url"] as string | undefined,
      workflowIdentity: flags["workflow-identity"] as string,
      yes: flags.yes as boolean
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
