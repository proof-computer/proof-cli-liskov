import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../../organization-context.js";

import { ARTIFACT_ENCRYPTION_MODES } from "../../../../artifact-upload.js";
import { runSlipwayApplicationArtifactUpload } from "../../../../session.js";

export default class SlipwayApplicationArtifactUpload extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Upload a bundle or native Cargo payload through a server-issued upload plan. Readiness does not publish or execute it.";
  static examples = [
    "<%= config.bin %> liskov application artifact upload cargo-app --kind native_payload --file payload.tar.gz --descriptor payload.json",
    "<%= config.bin %> liskov application artifact upload proof-docs --file bundle.zip",
    "<%= config.bin %> liskov application artifact upload proof-docs --file bundle.zip --organization org-123",
    "<%= config.bin %> liskov application artifact upload proof-docs --file bundle.zip --manifest .liskov/app.json --json"
  ];
  static flags: Interfaces.FlagInput = {
    kind: Flags.string({ default: "bundle", options: ["bundle", "native_payload"], description: "Artifact kind. Native payloads require --descriptor." }),
    descriptor: Flags.string({ description: "Companion liskov.cargo-payload.v1 descriptor JSON for native payload bytes." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "encryption-mode": Flags.string({
      default: "none",
      description: "Encryption posture of the uploaded bytes. Only none is supported; encrypted member uploads are refused before any request.",
      options: [...ARTIFACT_ENCRYPTION_MODES]
    }),
    file: Flags.string({ description: "Built bundle ZIP or native payload tar.gz to upload.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    manifest: Flags.string({ description: "Manifest file whose sha256 is recorded. Defaults to the bundle's own sha256." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Upload a bundle and record it as a deployable artifact.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationArtifactUpload);
    const code = await runSlipwayApplicationArtifactUpload({
      applicationRef: args.app_ref,
      kind: flags.kind as string | undefined,
      descriptor: flags.descriptor as string | undefined,
      config: flags.config as string | undefined,
      encryptionMode: flags["encryption-mode"] as string | undefined,
      file: flags.file as string,
      json: flags.json as boolean | undefined,
      manifest: flags.manifest as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
