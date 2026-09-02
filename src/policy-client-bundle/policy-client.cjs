const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { gunzipSync } = require("node:zlib");
const path = require("node:path");

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function loadPolicyContract(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, "policy-client-bundle.json"), "utf8"));
  const compressedWasm = readFileSync(path.join(directory, manifest.artifact.file));
  return createPolicyContract({ manifest, compressedWasm });
}

function createPolicyContract({ manifest, compressedWasm, evaluateOverride }) {
  if (manifest.schema !== "proof.liskov.policy-client-bundle.v1") {
    throw new Error("unsupported policy client bundle schema");
  }
  const compressedDigest = sha256(compressedWasm);
  if (compressedDigest !== manifest.artifact.sha256) {
    throw new Error(`policy client artifact digest mismatch: expected ${manifest.artifact.sha256}, got ${compressedDigest}`);
  }
  if (evaluateOverride) {
    return { manifest, evaluate: evaluateOverride };
  }
  const wasm = gunzipSync(compressedWasm);
  const wasmDigest = sha256(wasm);
  if (wasmDigest !== manifest.artifact.uncompressedSha256) {
    throw new Error(`policy client Wasm digest mismatch: expected ${manifest.artifact.uncompressedSha256}, got ${wasmDigest}`);
  }
  const module = new WebAssembly.Module(wasm);
  if (WebAssembly.Module.imports(module).length !== 0) {
    throw new Error("policy client Wasm must not have ambient imports");
  }
  const instance = new WebAssembly.Instance(module, {});
  const exports = instance.exports;
  for (const name of ["memory", "policy_contract_abi_version", "policy_contract_alloc", "policy_contract_free", "policy_contract_evaluate"]) {
    if (!(name in exports)) throw new Error(`policy client Wasm is missing ${name}`);
  }
  if (exports.policy_contract_abi_version() !== manifest.abiVersion) {
    throw new Error("policy client ABI version does not match its bundle manifest");
  }

  const evaluate = (request) => {
    const requestBytes = encoder.encode(JSON.stringify(request));
    const requestPointer = exports.policy_contract_alloc(requestBytes.length);
    const descriptorPointer = exports.policy_contract_alloc(8);
    let resultPointer = 0;
    let resultLength = 0;
    try {
      new Uint8Array(exports.memory.buffer, requestPointer, requestBytes.length).set(requestBytes);
      const status = exports.policy_contract_evaluate(requestPointer, requestBytes.length, descriptorPointer);
      if (status !== 0) throw new Error(`policy client evaluator failed with ABI status ${status}`);
      const descriptor = new DataView(exports.memory.buffer, descriptorPointer, 8);
      resultPointer = descriptor.getUint32(0, true);
      resultLength = descriptor.getUint32(4, true);
      const resultBytes = new Uint8Array(exports.memory.buffer, resultPointer, resultLength).slice();
      return JSON.parse(decoder.decode(resultBytes));
    } finally {
      if (resultPointer !== 0) exports.policy_contract_free(resultPointer, resultLength);
      exports.policy_contract_free(descriptorPointer, 8);
      exports.policy_contract_free(requestPointer, requestBytes.length);
    }
  };

  const described = evaluate({
    schema: "proof.liskov.policy-client-request.v1",
    operation: "describe"
  });
  if (JSON.stringify(described.supportedPairs) !== JSON.stringify(manifest.supportedPairs)) {
    throw new Error("policy client Wasm registry does not match its bundle manifest");
  }
  return { manifest, evaluate };
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

module.exports = { createPolicyContract, loadPolicyContract };
