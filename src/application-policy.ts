import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const APPLICATION_MANIFEST_SCHEMA = "proof.liskov.application-manifest";
export const APPLICATION_MANIFEST_VERSION = 4;
export const ATTESTED_RUNTIME_PROFILE = "proof.liskov.attested-runtime.v1";
export const ACURAST_SET_ENVIRONMENT_BOOTSTRAP_DELIVERY = "acurast-set-environment";

export interface PolicyValidationError {
  code: string;
  message: string;
  pointer: string;
}

export interface TailscaleSshProvider {
  integrationId: string;
  kind: "tailscale";
  port?: 22;
}

export interface LiskovSshProvider {
  authorizedKeys: string[];
  kind: "liskov";
}

export type RuntimeSshIngressPolicy =
  | { mode: "disabled" }
  | { mode: "optional" }
  | { mode: "required"; provider: LiskovSshProvider | TailscaleSshProvider };

export interface PolicySchemaPair {
  schema: string;
  schemaVersion: number;
}

export interface PolicyContractEvaluation {
  schema: "proof.liskov.policy-client-result.v1";
  operation: "describe" | "validate" | "materialize";
  disposition: "supported" | "unknown_opaque" | "invalid";
  valid: boolean;
  pair?: PolicySchemaPair;
  document?: unknown;
  errors: PolicyValidationError[];
  capabilityDiagnostics: PolicyValidationError[];
  deprecationDiagnostics: PolicyValidationError[];
  authoredDigest?: string;
  releaseIntentDigest?: string;
  effective?: unknown;
  policyDigest?: string;
  policyDiagnostics?: unknown;
}

export interface PolicyContractBundle {
  manifest: {
    publicationPairs: Array<PolicySchemaPair & { releaseMode: "source" }>;
  };
  evaluate(request: Record<string, unknown>): PolicyContractEvaluation;
}

let loaded: PolicyContractBundle | undefined;

/** Test-only seam for proving a declared later pair needs registration, not a
 * new client branch. Production never calls this. */
export function setPolicyContractForTesting(replacement: PolicyContractBundle | undefined): void {
  loaded = replacement;
}

function contract(): PolicyContractBundle {
  if (loaded) return loaded;
  const require = createRequire(import.meta.url);
  const adapter = require("./policy-client-bundle/policy-client.cjs") as {
    loadPolicyContract(directory: string): PolicyContractBundle;
  };
  loaded = adapter.loadPolicyContract(fileURLToPath(new URL("./policy-client-bundle/", import.meta.url)));
  return loaded;
}

export function evaluateApplicationManifestText(
  document: string,
  encoding: "json" | "yaml" = "json"
): PolicyContractEvaluation {
  return contract().evaluate({
    schema: "proof.liskov.policy-client-request.v1",
    operation: "validate",
    encoding,
    document
  });
}

export function evaluateApplicationManifest(value: unknown): PolicyContractEvaluation {
  return evaluateApplicationManifestText(JSON.stringify(value), "json");
}

export function isRegisteredSourcePublicationPair(result: PolicyContractEvaluation): boolean {
  if (result.disposition !== "supported" || !result.pair) return false;
  return contract().manifest.publicationPairs.some((pair) =>
    pair.schema === result.pair?.schema
    && pair.schemaVersion === result.pair?.schemaVersion
    && pair.releaseMode === "source");
}

export function validateApplicationManifest(value: unknown): PolicyValidationError[] {
  const result = evaluateApplicationManifest(value);
  return [...result.errors, ...result.capabilityDiagnostics, ...result.deprecationDiagnostics];
}

export function validateApplicationManifestV4(value: unknown): PolicyValidationError[] {
  return validateExactVersion(value, 4);
}

export function validateApplicationManifestV5(value: unknown): PolicyValidationError[] {
  return validateExactVersion(value, 5);
}

function validateExactVersion(value: unknown, version: number): PolicyValidationError[] {
  const result = evaluateApplicationManifest(value);
  if (result.pair?.schemaVersion !== version || result.pair.schema !== APPLICATION_MANIFEST_SCHEMA) {
    return result.errors.length > 0 ? result.errors : [{
      code: "invalid_manifest",
      message: `schema pair must be proof.liskov.application-manifest@${version}`,
      pointer: "/schemaVersion"
    }];
  }
  return [...result.errors, ...result.capabilityDiagnostics, ...result.deprecationDiagnostics];
}

export function authoredDigest(manifest: unknown): string {
  const result = evaluateApplicationManifest(manifest);
  if (!result.valid || !result.authoredDigest) throw new Error("manifest has no canonical authored digest");
  return result.authoredDigest;
}

export function releaseIntentDigest(manifest: unknown): string {
  const result = evaluateApplicationManifest(manifest);
  if (!result.valid || !result.releaseIntentDigest) throw new Error("manifest has no canonical release-intent digest");
  return result.releaseIntentDigest;
}
