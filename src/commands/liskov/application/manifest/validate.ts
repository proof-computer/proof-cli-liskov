import { readFile } from "node:fs/promises";

import { Command, Flags, type Interfaces } from "@oclif/core";

import {
  authoredDigest,
  releaseIntentDigest,
  validateApplicationManifestV4
} from "../../../../application-policy.js";

export default class LiskovApplicationManifestValidate extends Command {
  static description = "Strictly validate an authored Application manifest v4 file without publishing it.";
  static examples = [
    "<%= config.bin %> liskov application manifest validate --file .liskov/application-manifest.json",
    "<%= config.bin %> liskov application manifest validate --file manifest.json --json"
  ];
  static flags: Interfaces.FlagInput = {
    file: Flags.string({ char: "f", description: "Application manifest JSON file.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." })
  };
  static summary = "Validate an authored Application manifest v4.";

  async run(): Promise<void> {
    const { flags } = await this.parse(LiskovApplicationManifestValidate);
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(flags.file as string, "utf8")) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (flags.json) this.log(JSON.stringify({ ok: false, manifestValid: false, error: "invalid_manifest_file", message }));
      else this.error(`Unable to read manifest: ${message}`, { exit: 1 });
      this.exit(1);
    }
    const diagnostics = validateApplicationManifestV4(manifest);
    const errors = diagnostics.filter((diagnostic) =>
      diagnostic.code === "invalid_manifest" || diagnostic.code === "unknown_field");
    const capabilityDiagnostics = diagnostics.filter((diagnostic) =>
      diagnostic.code === "unsupported_policy_feature" || diagnostic.code === "entitlement_exceeded");
    const deprecationDiagnostics = diagnostics.filter((diagnostic) =>
      diagnostic.code === "deprecated_manifest_field");
    const manifestValid = errors.length === 0;
    const result = {
      ok: manifestValid,
      manifestValid,
      ...(manifestValid
        ? { authoredDigest: authoredDigest(manifest), releaseIntentDigest: releaseIntentDigest(manifest) }
        : {}),
      firstPublicReady: manifestValid && capabilityDiagnostics.length === 0,
      errors,
      capabilityDiagnostics,
      deprecationDiagnostics
    };
    if (flags.json) this.log(JSON.stringify(result));
    else if (manifestValid) {
      this.log(`Application manifest v4 is valid.
authoredDigest: ${result.authoredDigest}
releaseIntentDigest: ${result.releaseIntentDigest}
firstPublicReady: ${String(result.firstPublicReady)}`);
      for (const diagnostic of capabilityDiagnostics) {
        this.log(`${diagnostic.code} ${diagnostic.pointer || "/"}: ${diagnostic.message}`);
      }
      for (const diagnostic of deprecationDiagnostics) {
        this.log(`${diagnostic.code} ${diagnostic.pointer || "/"}: ${diagnostic.message}`);
      }
    }
    else {
      for (const error of errors) this.log(`${error.code} ${error.pointer || "/"}: ${error.message}`);
    }
    if (errors.length > 0) this.exit(1);
  }
}
