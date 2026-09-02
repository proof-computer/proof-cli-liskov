import { readFile } from "node:fs/promises";

import { Command, Flags, type Interfaces } from "@oclif/core";

import {
  evaluateApplicationManifestText,
  type PolicyContractEvaluation
} from "../../../../application-policy.js";

export default class LiskovApplicationManifestValidate extends Command {
  static description = "Strictly validate an authored Application manifest v4 or retained V5 file without publishing it.";
  static examples = [
    "<%= config.bin %> liskov application manifest validate --file .liskov/application-manifest.json",
    "<%= config.bin %> liskov application manifest validate --file manifest.json --json"
  ];
  static flags: Interfaces.FlagInput = {
    file: Flags.string({ char: "f", description: "Application manifest JSON file.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." })
  };
  static summary = "Validate an authored Application manifest v4 or retained V5.";

  async run(): Promise<void> {
    const { flags } = await this.parse(LiskovApplicationManifestValidate);
    let evaluation: PolicyContractEvaluation;
    try {
      evaluation = evaluateApplicationManifestText(await readFile(flags.file as string, "utf8"), "json");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (flags.json) this.log(JSON.stringify({ ok: false, manifestValid: false, error: "invalid_manifest_file", message }));
      else this.error(`Unable to read manifest: ${message}`, { exit: 1 });
      this.exit(1);
    }
    const schemaVersion = evaluation.pair?.schemaVersion;
    const errors = evaluation.errors;
    const capabilityDiagnostics = evaluation.capabilityDiagnostics;
    const deprecationDiagnostics = evaluation.deprecationDiagnostics;
    const manifestValid = evaluation.valid;
    const result = {
      ok: manifestValid,
      manifestValid,
      schemaVersion,
      ...(manifestValid
        ? {
            authoredDigest: evaluation.authoredDigest,
            releaseIntentDigest: evaluation.releaseIntentDigest
          }
        : {}),
      firstPublicReady: manifestValid && capabilityDiagnostics.length === 0,
      errors,
      capabilityDiagnostics,
      deprecationDiagnostics
    };
    if (flags.json) this.log(JSON.stringify(result));
    else if (manifestValid) {
      const digestLines = [
        `Application manifest v${String(schemaVersion)} is valid.`,
        `authoredDigest: ${result.authoredDigest}`,
        ...("releaseIntentDigest" in result ? [`releaseIntentDigest: ${result.releaseIntentDigest}`] : []),
        `firstPublicReady: ${String(result.firstPublicReady)}`
      ];
      this.log(digestLines.join("\n"));
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
