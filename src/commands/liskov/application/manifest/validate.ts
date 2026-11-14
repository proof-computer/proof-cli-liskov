import { readFile, writeFile } from "node:fs/promises";

import { Flags, type Interfaces } from "@oclif/core";
import { AnalyticsCommand } from "../../../../analytics-command.js";

import {
  evaluateApplicationManifestText,
  type PolicyContractEvaluation
} from "../../../../application-policy.js";

export default class LiskovApplicationManifestValidate extends AnalyticsCommand {
  static description = "Strictly validate a registered authored Application manifest, including dark V8, without publishing it.";
  static examples = [
    "<%= config.bin %> liskov application manifest validate --file .liskov/application-manifest.json",
    "<%= config.bin %> liskov application manifest validate --file manifest.json --json"
  ];
  static flags: Interfaces.FlagInput = {
    export: Flags.string({ description: "Write the contract-validated authored JSON to a new file; refuses overwrite." }),
    file: Flags.string({ char: "f", description: "Application manifest JSON file.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." })
  };
  static summary = "Validate an authored Application manifest offline.";

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
    if (flags.export !== undefined && manifestValid) {
      try {
        await writeFile(flags.export as string, `${JSON.stringify(evaluation.document, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      } catch {
        if (flags.json) this.log(JSON.stringify({ ok: false, error: "manifest_export_failed" }));
        else this.log("Unable to export manifest; choose a writable path to a new file.");
        this.exit(1);
      }
    }
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
      firstPublicReady: manifestValid && schemaVersion !== 8 && capabilityDiagnostics.length === 0,
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
    if (!manifestValid) this.exit(1);
  }
}
