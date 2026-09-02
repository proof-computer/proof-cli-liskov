export interface PolicyClientBundleManifest {
  schema: "proof.liskov.policy-client-bundle.v1";
  abiVersion: number;
  artifact: { file: string; sha256: string; uncompressedSha256: string };
  supportedPairs: Array<{ schema: string; schemaVersion: number }>;
  publicationPairs: Array<{ schema: string; schemaVersion: number; releaseMode: "source" }>;
  sourceDigest: string;
}

export interface PolicyContract {
  manifest: PolicyClientBundleManifest;
  evaluate(request: Record<string, unknown>): Record<string, unknown>;
}

export function loadPolicyContract(directory: string): PolicyContract;
export function createPolicyContract(input: {
  manifest: PolicyClientBundleManifest;
  compressedWasm: Uint8Array;
  evaluateOverride?: (request: Record<string, unknown>) => Record<string, unknown>;
}): PolicyContract;
