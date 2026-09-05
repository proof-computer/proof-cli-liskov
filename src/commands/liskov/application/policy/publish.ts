import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationPolicyPublish } from "../../../../session.js";

export default class LiskovApplicationPolicyPublish extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Exact Liskov Application id; must match document.applicationId.", required: true })
  };
  static description = "Publish one locally supported source document through the registered policy-version writer.";
  static examples = [
    "<%= config.bin %> liskov application policy publish proof-docs --file .liskov/proof-docs-v5.json --artifact-digest sha256:... --binding-revision 1 --revocation-epoch 0 --source-ref refs/heads/main --source-commit 0123456789abcdef0123456789abcdef01234567 --workflow-identity proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main --expected-pointer-version 0 --yes",
    "<%= config.bin %> liskov application policy publish proof-docs --file manifest.json --artifact-digest sha256:... --binding-revision 1 --revocation-epoch 0 --source-ref refs/heads/main --source-commit 0123456789abcdef0123456789abcdef01234567 --workflow-identity proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main --expected-pointer-version 0 --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    "artifact-digest": Flags.string({ description: "Exact attested sha256 artifact digest.", required: true }),
    "binding-revision": Flags.integer({ description: "Source-binding revision carried by the attested build.", min: 0, required: true }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "expected-pointer-version": Flags.integer({ description: "Active pointer version observed before publication.", min: 0, required: true }),
    "dry-run": Flags.boolean({ description: "Preview the registered publication without committing policy, pointer, or wakeup.", exclusive: ["yes"] }),
    paused: Flags.boolean({ description: "Atomically leave the published Application paused for setup." }),
    reason: Flags.string({ description: "Required reason for --paused (1 to 500 characters).", dependsOn: ["paused"] }),
    file: Flags.string({ char: "f", description: "Supported Application manifest JSON file.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "revocation-epoch": Flags.integer({ description: "Source-binding revocation epoch carried by the attested build.", min: 0, required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    "source-commit": Flags.string({ description: "Exact 40-character source commit attested by the build.", required: true }),
    "source-ref": Flags.string({ description: "Exact source ref attested by the build.", required: true }),
    "workflow-identity": Flags.string({ description: "Exact GitHub workflow identity attested by the build.", required: true }),
    yes: Flags.boolean({ char: "y", description: "Confirm the registered policy publication mutation.", exclusive: ["dry-run"] })
  };
  static summary = "Publish a registered source policy version.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationPolicyPublish);
    const code = await runSlipwayApplicationPolicyPublish({
      applicationRef: args.app_ref,
      artifactDigest: flags["artifact-digest"] as string,
      bindingRevision: flags["binding-revision"] as number,
      config: flags.config as string | undefined,
      expectedPointerVersion: flags["expected-pointer-version"] as number,
      file: flags.file as string,
      dryRun: flags["dry-run"] as boolean | undefined,
      paused: flags.paused as boolean | undefined,
      reason: flags.reason as string | undefined,
      json: flags.json as boolean | undefined,
      revocationEpoch: flags["revocation-epoch"] as number,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      sourceCommit: flags["source-commit"] as string,
      sourceRef: flags["source-ref"] as string,
      workflowIdentity: flags["workflow-identity"] as string,
      yes: flags.yes as boolean
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
