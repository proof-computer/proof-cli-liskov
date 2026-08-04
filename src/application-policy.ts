import { createHash } from "node:crypto";

export const APPLICATION_MANIFEST_SCHEMA = "proof.liskov.application-manifest";
export const APPLICATION_MANIFEST_VERSION = 4;
export const ATTESTED_RUNTIME_PROFILE = "proof.liskov.attested-runtime.v1";
export const ACURAST_SET_ENVIRONMENT_BOOTSTRAP_DELIVERY = "acurast-set-environment";

export interface PolicyValidationError {
  code: "invalid_manifest" | "unknown_field" | "unsupported_policy_feature" | "entitlement_exceeded" | "deprecated_manifest_field";
  message: string;
  pointer: string;
}

type JsonObject = Record<string, unknown>;

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

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function pointer(parent: string, child: string): string {
  return `${parent}/${child.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function checkObject(
  value: unknown,
  at: string,
  allowed: readonly string[],
  errors: PolicyValidationError[],
  required: readonly string[] = []
): JsonObject {
  const result = object(value);
  if (!result) {
    errors.push({ code: "invalid_manifest", message: "must be an object", pointer: at });
    return {};
  }
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) {
      errors.push({ code: "unknown_field", message: `unknown field ${key}`, pointer: pointer(at, key) });
    }
  }
  for (const key of required) {
    if (!(key in result)) {
      errors.push({ code: "invalid_manifest", message: `missing required field ${key}`, pointer: pointer(at, key) });
    }
  }
  return result;
}

function checkEnum(
  value: unknown,
  allowed: readonly string[],
  at: string,
  errors: PolicyValidationError[]
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push({ code: "invalid_manifest", message: `must be one of ${allowed.join(", ")}`, pointer: at });
  }
}

function checkOptionalObject(
  parent: JsonObject,
  key: string,
  at: string,
  allowed: readonly string[],
  errors: PolicyValidationError[],
  required: readonly string[] = []
): JsonObject {
  if (parent[key] === undefined) return {};
  return checkObject(parent[key], pointer(at, key), allowed, errors, required);
}

function checkArrayObjects(
  value: unknown,
  at: string,
  allowed: readonly string[],
  errors: PolicyValidationError[],
  required: readonly string[] = []
): JsonObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push({ code: "invalid_manifest", message: "must be an array", pointer: at });
    return [];
  }
  return value.map((item, index) => checkObject(item, `${at}/${index}`, allowed, errors, required));
}

function checkOptionalString(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (value !== undefined && typeof value !== "string") {
    errors.push({ code: "invalid_manifest", message: "must be a string", pointer: at });
  }
}

function checkStringArray(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push({ code: "invalid_manifest", message: "must be an array of strings", pointer: at });
  }
}

function checkInteger(
  value: unknown,
  at: string,
  errors: PolicyValidationError[],
  min: number,
  max = Number.MAX_SAFE_INTEGER,
  optional = true
): void {
  if (value === undefined && optional) return;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    errors.push({ code: "invalid_manifest", message: `must be an integer in ${min}..=${max}`, pointer: at });
  }
}

function checkNonEmptyString(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ code: "invalid_manifest", message: "must be a non-empty string", pointer: at });
  }
}

function checkSha256(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    errors.push({
      code: "invalid_manifest",
      message: "must be sha256: followed by 64 lowercase hexadecimal characters",
      pointer: at
    });
  }
}

function checkIpfsUri(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (typeof value !== "string" || !/^ipfs:\/\/[A-Za-z0-9]+$/u.test(value)) {
    errors.push({ code: "invalid_manifest", message: "must be a canonical non-empty ipfs:// URI", pointer: at });
  }
}

function checkDuplicateStrings(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (!Array.isArray(value)) return;
  const seen = new Map<string, number>();
  value.forEach((entry, index) => {
    if (typeof entry !== "string") return;
    if (!entry.trim()) {
      errors.push({ code: "invalid_manifest", message: "set members must be non-empty", pointer: `${at}/${index}` });
    }
    const first = seen.get(entry);
    if (first !== undefined) {
      errors.push({
        code: "invalid_manifest",
        message: `duplicate keyed entry; first declared at index ${first}`,
        pointer: `${at}/${index}`
      });
    } else {
      seen.set(entry, index);
    }
  });
}

function checkManagedAuthorizedKeys(value: unknown, errors: PolicyValidationError[]): void {
  const at = "/ingress/ssh/provider/authorizedKeys";
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    errors.push({ code: "invalid_manifest", message: "must contain one to eight Ed25519 public keys", pointer: at });
    return;
  }
  const fingerprints = new Set<string>();
  value.forEach((key, index) => {
    const pointer = `${at}/${index}`;
    if (typeof key !== "string" || key.trim() !== key || key.split(" ").length !== 2) {
      errors.push({ code: "invalid_manifest", message: "must be normalized ssh-ed25519 key material without options or comments", pointer });
      return;
    }
    const [algorithm, encoded] = key.split(" ");
    let blob: Buffer;
    try {
      blob = Buffer.from(encoded, "base64");
    } catch {
      errors.push({ code: "invalid_manifest", message: "must be a canonical Ed25519 SSH public key", pointer });
      return;
    }
    if (
      algorithm !== "ssh-ed25519"
      || blob.length !== 51
      || blob.readUInt32BE(0) !== 11
      || blob.subarray(4, 15).toString("ascii") !== "ssh-ed25519"
      || blob.readUInt32BE(15) !== 32
      || blob.toString("base64") !== encoded
    ) {
      errors.push({ code: "invalid_manifest", message: "must be a canonical Ed25519 SSH public key", pointer });
      return;
    }
    const fingerprint = createHash("sha256").update(blob).digest("base64url");
    if (fingerprints.has(fingerprint)) {
      errors.push({ code: "invalid_manifest", message: "authorized key fingerprints must be unique", pointer });
    }
    fingerprints.add(fingerprint);
  });
}

function checkDuplicateKeys(
  values: JsonObject[],
  key: string,
  at: string,
  errors: PolicyValidationError[]
): void {
  const seen = new Map<unknown, number>();
  values.forEach((entry, index) => {
    const value = entry[key];
    const first = seen.get(value);
    if (first !== undefined) {
      errors.push({
        code: "invalid_manifest",
        message: `duplicate keyed entry; first declared at index ${first}`,
        pointer: `${at}/${index}`
      });
    } else {
      seen.set(value, index);
    }
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = object(value);
  if (record) {
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function authoredDigest(manifest: unknown): string {
  return canonicalDigest(manifest);
}

export function releaseIntentDigest(manifest: unknown): string {
  const root = object(manifest) ?? {};
  const release = structuredClone(root.release);
  const releaseObject = object(release);
  const builder = object(releaseObject?.builder);
  if (releaseObject?.mode === "build" && Array.isArray(builder?.allowedRefs)) {
    builder.allowedRefs = [...builder.allowedRefs].sort();
  }
  return canonicalDigest({
    schema: "proof.liskov.release-intent",
    schemaVersion: APPLICATION_MANIFEST_VERSION,
    applicationId: root.applicationId,
    release
  });
}

export function validateApplicationManifestV4(value: unknown): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const root = checkObject(value, "", [
    "schema", "schemaVersion", "applicationId", "applicationUid", "metadata",
    "release", "runtime", "deployment", "ingress", "observability", "configuration"
  ], errors, ["schema", "schemaVersion", "applicationId", "release", "deployment"]);
  if (root.schema !== APPLICATION_MANIFEST_SCHEMA) {
    errors.push({ code: "invalid_manifest", message: `schema must be ${APPLICATION_MANIFEST_SCHEMA}`, pointer: "/schema" });
  }
  if (root.schemaVersion !== APPLICATION_MANIFEST_VERSION) {
    errors.push({ code: "invalid_manifest", message: "schemaVersion must be 4", pointer: "/schemaVersion" });
  }
  if (typeof root.applicationId !== "string" || !root.applicationId.trim()) {
    errors.push({ code: "invalid_manifest", message: "applicationId must be non-empty", pointer: "/applicationId" });
  }
  if (root.applicationUid !== undefined && (typeof root.applicationUid !== "string" || !root.applicationUid.trim())) {
    errors.push({ code: "invalid_manifest", message: "applicationUid must be non-empty when present", pointer: "/applicationUid" });
  }

  const metadata = checkOptionalObject(root, "metadata", "", ["appType", "labels", "description"], errors);
  checkOptionalString(metadata.appType, "/metadata/appType", errors);
  checkOptionalString(metadata.description, "/metadata/description", errors);
  checkStringArray(metadata.labels, "/metadata/labels", errors);
  const release = checkObject(root.release, "/release", ["mode", "artifact", "builder"], errors, ["mode", "artifact"]);
  checkEnum(release.mode, ["build", "pinned"], "/release/mode", errors);
  if (release.mode === "build") {
    checkObject(root.release, "/release", ["mode", "artifact", "builder"], errors, ["mode", "artifact", "builder"]);
    const artifact = checkObject(release.artifact, "/release/artifact", ["kind", "encryption"], errors, ["kind"]);
    checkEnum(artifact.kind, ["ipfs_bundle", "runtime_image"], "/release/artifact/kind", errors);
    if (artifact.kind === "ipfs_bundle") {
      checkObject(release.artifact, "/release/artifact", ["kind", "encryption"], errors, ["kind", "encryption"]);
      const encryption = checkObject(artifact.encryption, "/release/artifact/encryption", ["mode"], errors, ["mode"]);
      checkEnum(encryption.mode, ["none", "aes256_gcm"], "/release/artifact/encryption/mode", errors);
    } else if (artifact.kind === "runtime_image") {
      checkObject(release.artifact, "/release/artifact", ["kind"], errors, ["kind"]);
    }
    const builder = checkObject(release.builder, "/release/builder", [
      "kind", "repository", "allowedRefs", "workflowRef", "manifestPath"
    ], errors, ["kind", "repository", "allowedRefs", "workflowRef", "manifestPath"]);
    checkEnum(builder.kind, ["github"], "/release/builder/kind", errors);
    checkNonEmptyString(builder.repository, "/release/builder/repository", errors);
    if (typeof builder.repository === "string" && !/^[^/\s]+\/[^/\s]+$/u.test(builder.repository)) {
      errors.push({ code: "invalid_manifest", message: "repository must be an owner/repository identifier", pointer: "/release/builder/repository" });
    }
    checkStringArray(builder.allowedRefs, "/release/builder/allowedRefs", errors);
    if (!Array.isArray(builder.allowedRefs) || builder.allowedRefs.length === 0) {
      errors.push({ code: "invalid_manifest", message: "allowedRefs must contain at least one exact Git ref", pointer: "/release/builder/allowedRefs" });
    } else {
      builder.allowedRefs.forEach((reference, index) => {
        if (typeof reference === "string" && (!reference.startsWith("refs/") || reference.trim() !== reference || /\s/u.test(reference))) {
          errors.push({ code: "invalid_manifest", message: "allowed refs must be exact refs/... values", pointer: `/release/builder/allowedRefs/${index}` });
        }
      });
    }
    checkDuplicateStrings(builder.allowedRefs, "/release/builder/allowedRefs", errors);
    checkNonEmptyString(builder.manifestPath, "/release/builder/manifestPath", errors);
    if (typeof builder.manifestPath === "string"
      && (builder.manifestPath.startsWith("/") || builder.manifestPath.includes("\\")
        || builder.manifestPath.split("/").some((part) => !part || part === "." || part === ".."))) {
      errors.push({ code: "invalid_manifest", message: "manifestPath must be a safe relative repository path", pointer: "/release/builder/manifestPath" });
    }
    checkNonEmptyString(builder.workflowRef, "/release/builder/workflowRef", errors);
    if (typeof builder.repository === "string" && typeof builder.workflowRef === "string" && Array.isArray(builder.allowedRefs)) {
      const prefix = `${builder.repository}/.github/workflows/`;
      const at = builder.workflowRef.lastIndexOf("@");
      const workflowPath = builder.workflowRef.slice(prefix.length, at);
      const workflowRef = builder.workflowRef.slice(at + 1);
      if (!builder.workflowRef.startsWith(prefix) || at <= prefix.length
        || (!workflowPath.endsWith(".yml") && !workflowPath.endsWith(".yaml"))
        || !builder.allowedRefs.includes(workflowRef)) {
        errors.push({ code: "invalid_manifest", message: "workflowRef must name an exact workflow in repository at one allowed ref", pointer: "/release/builder/workflowRef" });
      }
    }
  } else if (release.mode === "pinned") {
    checkObject(root.release, "/release", ["mode", "artifact"], errors, ["mode", "artifact"]);
    const artifact = checkObject(release.artifact, "/release/artifact", [
      "kind", "cid", "digest", "encryption", "imageDigest", "bootstrapCid", "bootstrapDigest"
    ], errors, ["kind"]);
    checkEnum(artifact.kind, ["ipfs_bundle", "runtime_image"], "/release/artifact/kind", errors);
    if (artifact.kind === "ipfs_bundle") {
      checkObject(release.artifact, "/release/artifact", ["kind", "cid", "digest", "encryption"], errors, [
        "kind", "cid", "digest", "encryption"
      ]);
      checkIpfsUri(artifact.cid, "/release/artifact/cid", errors);
      checkSha256(artifact.digest, "/release/artifact/digest", errors);
      const encryption = checkObject(artifact.encryption, "/release/artifact/encryption", ["mode"], errors, ["mode"]);
      checkEnum(encryption.mode, ["none", "aes256_gcm"], "/release/artifact/encryption/mode", errors);
    } else if (artifact.kind === "runtime_image") {
      checkObject(release.artifact, "/release/artifact", [
        "kind", "imageDigest", "bootstrapCid", "bootstrapDigest"
      ], errors, ["kind", "imageDigest", "bootstrapCid", "bootstrapDigest"]);
      checkSha256(artifact.imageDigest, "/release/artifact/imageDigest", errors);
      checkIpfsUri(artifact.bootstrapCid, "/release/artifact/bootstrapCid", errors);
      checkSha256(artifact.bootstrapDigest, "/release/artifact/bootstrapDigest", errors);
    }
  }

  const runtime = checkOptionalObject(root, "runtime", "", [
    "engine", "command", "role", "resources", "requiredModules", "bootstrap",
    "bootstrapDelivery", "maxGenerations"
  ], errors);
  if (runtime.engine !== undefined) checkEnum(runtime.engine, ["nodejs", "deno", "bun"], "/runtime/engine", errors);
  checkOptionalString(runtime.command, "/runtime/command", errors);
  checkOptionalString(runtime.role, "/runtime/role", errors);
  if (runtime.bootstrapDelivery !== undefined) {
    checkEnum(
      runtime.bootstrapDelivery,
      [ACURAST_SET_ENVIRONMENT_BOOTSTRAP_DELIVERY],
      "/runtime/bootstrapDelivery",
      errors
    );
  }
  checkInteger(runtime.maxGenerations, "/runtime/maxGenerations", errors, 1);
  checkStringArray(runtime.requiredModules, "/runtime/requiredModules", errors);
  checkDuplicateStrings(runtime.requiredModules, "/runtime/requiredModules", errors);
  const resources = checkOptionalObject(runtime, "resources", "/runtime", ["memoryMiB", "storageMiB", "networkRequestQuota"], errors);
  for (const key of ["memoryMiB", "storageMiB", "networkRequestQuota"]) {
    checkInteger(resources[key], `/runtime/resources/${key}`, errors, 0);
  }
  const bootstrap = checkOptionalObject(runtime, "bootstrap", "/runtime", [
    "trustProfile", "signedDiagnosticsRequired", "identityBoundSecretsRequired"
  ], errors);
  if (bootstrap.trustProfile !== undefined && bootstrap.trustProfile !== ATTESTED_RUNTIME_PROFILE) {
    errors.push({ code: "invalid_manifest", message: "attested runtime trust is mandatory", pointer: "/runtime/bootstrap/trustProfile" });
  }
  for (const key of ["signedDiagnosticsRequired", "identityBoundSecretsRequired"]) {
    if (bootstrap[key] !== undefined && bootstrap[key] !== true) {
      errors.push({ code: "invalid_manifest", message: `${key} cannot be disabled`, pointer: `/runtime/bootstrap/${key}` });
    }
  }

  const deployment = checkObject(root.deployment, "/deployment", [
    "parallelism", "schedule", "placement", "lifecycle", "spend"
  ], errors, ["parallelism", "schedule", "lifecycle"]);
  const parallelism = deployment.parallelism;
  if (!Number.isSafeInteger(parallelism) || (parallelism as number) < 1 || (parallelism as number) > 64) {
    errors.push({ code: "invalid_manifest", message: "parallelism must be an integer in 1..=64", pointer: "/deployment/parallelism" });
  } else if ((parallelism as number) > 1) {
    errors.push({ code: "unsupported_policy_feature", message: "parallelism above 1 is not enabled", pointer: "/deployment/parallelism" });
    errors.push({ code: "entitlement_exceeded", message: "parallelism exceeds the default entitlement", pointer: "/deployment/parallelism" });
  }
  const schedule = checkObject(deployment.schedule, "/deployment/schedule", [
    "durationMs", "startDelayMs", "maxStartDelayMs"
  ], errors, ["durationMs"]);
  const durationMs = schedule.durationMs;
  if (!Number.isSafeInteger(durationMs) || (durationMs as number) <= 0) {
    errors.push({ code: "invalid_manifest", message: "durationMs must be a positive integer", pointer: "/deployment/schedule/durationMs" });
  }
  checkInteger(schedule.startDelayMs, "/deployment/schedule/startDelayMs", errors, 0);
  checkInteger(schedule.maxStartDelayMs, "/deployment/schedule/maxStartDelayMs", errors, 0);
  if (typeof schedule.startDelayMs === "number" && typeof schedule.maxStartDelayMs === "number"
    && schedule.startDelayMs > schedule.maxStartDelayMs) {
    errors.push({ code: "invalid_manifest", message: "startDelayMs cannot exceed maxStartDelayMs", pointer: "/deployment/schedule/startDelayMs" });
  }

  const placement = checkOptionalObject(deployment, "placement", "/deployment", [
    "requirements", "groups", "topologyConstraints", "processorSelection"
  ], errors);
  const requirements = checkOptionalObject(placement, "requirements", "/deployment/placement", [
    "trustProfile", "machine", "evidence"
  ], errors);
  if (requirements.trustProfile !== undefined && requirements.trustProfile !== ATTESTED_RUNTIME_PROFILE) {
    errors.push({ code: "invalid_manifest", message: "placement trust profile cannot be weakened", pointer: "/deployment/placement/requirements/trustProfile" });
  }
  const machine = checkOptionalObject(requirements, "machine", "/deployment/placement/requirements", [
    "class", "profileVersion", "minimums"
  ], errors);
  checkOptionalString(machine.class, "/deployment/placement/requirements/machine/class", errors);
  checkOptionalString(machine.profileVersion, "/deployment/placement/requirements/machine/profileVersion", errors);
  const minimums = object(machine.minimums);
  if (machine.minimums !== undefined && !minimums) {
    errors.push({ code: "invalid_manifest", message: "must be an object", pointer: "/deployment/placement/requirements/machine/minimums" });
  } else if (minimums) {
    for (const [key, minimum] of Object.entries(minimums)) {
      checkInteger(minimum, `/deployment/placement/requirements/machine/minimums/${key}`, errors, 0);
    }
  }
  const evidence = checkArrayObjects(requirements.evidence, "/deployment/placement/requirements/evidence", [
    "profile", "metric", "minimum", "maxAgeMs", "minimumSamples", "minimumConfidenceBps", "strength"
  ], errors, ["profile", "metric", "minimum", "maxAgeMs", "minimumSamples", "minimumConfidenceBps", "strength"]);
  for (const [index, requirement] of evidence.entries()) {
    checkOptionalString(requirement.profile, `/deployment/placement/requirements/evidence/${index}/profile`, errors);
    checkOptionalString(requirement.metric, `/deployment/placement/requirements/evidence/${index}/metric`, errors);
    checkInteger(requirement.minimum, `/deployment/placement/requirements/evidence/${index}/minimum`, errors, 0, Number.MAX_SAFE_INTEGER, false);
    checkInteger(requirement.maxAgeMs, `/deployment/placement/requirements/evidence/${index}/maxAgeMs`, errors, 0, Number.MAX_SAFE_INTEGER, false);
    checkInteger(requirement.minimumSamples, `/deployment/placement/requirements/evidence/${index}/minimumSamples`, errors, 0, 4_294_967_295, false);
    checkInteger(requirement.minimumConfidenceBps, `/deployment/placement/requirements/evidence/${index}/minimumConfidenceBps`, errors, 0, 65_535, false);
    checkEnum(requirement.strength, ["required", "preferred"], `/deployment/placement/requirements/evidence/${index}/strength`, errors);
  }
  const groups = checkArrayObjects(placement.groups, "/deployment/placement/groups", [
    "name", "count", "geography"
  ], errors, ["name", "count", "geography"]);
  for (const [index, group] of groups.entries()) {
    checkOptionalString(group.name, `/deployment/placement/groups/${index}/name`, errors);
    checkInteger(group.count, `/deployment/placement/groups/${index}/count`, errors, 1, 65_535, false);
    const geographyAt = `/deployment/placement/groups/${index}/geography`;
    const geography = checkObject(group.geography, geographyAt, [
      "kind", "standard", "catalog", "values"
    ], errors, ["kind", "values"]);
    if (geography.kind !== undefined) checkEnum(geography.kind, ["country", "region"], `/deployment/placement/groups/${index}/geography/kind`, errors);
    checkStringArray(geography.values, `${geographyAt}/values`, errors);
    if (geography.kind === "country") {
      checkObject(group.geography, geographyAt, ["kind", "standard", "values"], errors, ["kind", "standard", "values"]);
      if (geography.standard !== "ISO-3166-1-alpha-2") {
        errors.push({ code: "invalid_manifest", message: "standard must be ISO-3166-1-alpha-2", pointer: `${geographyAt}/standard` });
      }
      if (Array.isArray(geography.values) && (geography.values.length === 0
        || geography.values.some((entry) => typeof entry !== "string" || !/^[A-Z]{2}$/.test(entry)))) {
        errors.push({ code: "invalid_manifest", message: "country values must be uppercase ISO alpha-2 codes", pointer: `${geographyAt}/values` });
      }
    } else if (geography.kind === "region") {
      checkObject(group.geography, geographyAt, ["kind", "catalog", "values"], errors, ["kind", "catalog", "values"]);
      if (typeof geography.catalog !== "string" || !geography.catalog.trim()) {
        errors.push({ code: "invalid_manifest", message: "catalog must be a non-empty string", pointer: `${geographyAt}/catalog` });
      }
      if (Array.isArray(geography.values) && geography.values.length === 0) {
        errors.push({ code: "invalid_manifest", message: "region values cannot be empty", pointer: `${geographyAt}/values` });
      }
    }
  }
  if (groups.length > 0) {
    errors.push({ code: "unsupported_policy_feature", message: "counted placement groups are not enabled", pointer: "/deployment/placement/groups" });
    const sum = groups.reduce((total, group) => total + (typeof group.count === "number" ? group.count : 0), 0);
    if (typeof parallelism === "number" && sum !== parallelism) {
      errors.push({ code: "invalid_manifest", message: "placement group counts must sum to parallelism", pointer: "/deployment/placement/groups" });
    }
  }
  checkDuplicateKeys(groups, "name", "/deployment/placement/groups", errors);
  const topology = checkArrayObjects(placement.topologyConstraints, "/deployment/placement/topologyConstraints", [
    "kind", "scope", "topologyKey", "strength"
  ], errors, ["kind", "scope", "topologyKey", "strength"]);
  if (topology.length > 0) {
    errors.push({ code: "unsupported_policy_feature", message: "topology constraints are not enabled", pointer: "/deployment/placement/topologyConstraints" });
  }
  const seenTopology = new Set<string>();
  topology.forEach((constraint, index) => {
    const key = canonicalJson(constraint);
    if (seenTopology.has(key)) {
      errors.push({ code: "invalid_manifest", message: "duplicate set entry", pointer: `/deployment/placement/topologyConstraints/${index}` });
    }
    seenTopology.add(key);
  });
  for (const [index, constraint] of topology.entries()) {
    const at = `/deployment/placement/topologyConstraints/${index}`;
    checkEnum(constraint.kind, ["affinity", "anti_affinity"], `${at}/kind`, errors);
    checkEnum(constraint.scope, ["this_deployment"], `${at}/scope`, errors);
    checkEnum(constraint.topologyKey, ["processor", "operator", "manager", "country", "region"], `${at}/topologyKey`, errors);
    checkEnum(constraint.strength, ["required", "preferred"], `${at}/strength`, errors);
  }
  const selection = checkOptionalObject(placement, "processorSelection", "/deployment/placement", [
    "mode", "managerId", "processorIds", "excludeManagers", "allowUnknownManager",
    "requireScheduleClear", "requireConsumerAccess", "maxHeartbeatAgeSeconds",
    "candidateLimit", "scanLimit"
  ], errors);
  const selectionControls = [
    "excludeManagers", "allowUnknownManager", "requireScheduleClear", "requireConsumerAccess",
    "maxHeartbeatAgeSeconds", "candidateLimit", "scanLimit"
  ];
  if (selection.mode !== undefined) checkEnum(selection.mode, ["open_market", "manager", "static"], "/deployment/placement/processorSelection/mode", errors);
  if (selection.mode === "open_market") {
    checkObject(placement.processorSelection, "/deployment/placement/processorSelection", [
      "mode", ...selectionControls
    ], errors, ["mode"]);
  } else if (selection.mode === "manager") {
    checkObject(placement.processorSelection, "/deployment/placement/processorSelection", [
      "mode", "managerId", ...selectionControls
    ], errors, ["mode", "managerId"]);
    if (typeof selection.managerId !== "string" || !selection.managerId.trim()) {
      errors.push({ code: "invalid_manifest", message: "managerId must be non-empty", pointer: "/deployment/placement/processorSelection/managerId" });
    }
  } else if (selection.mode === "static") {
    checkObject(placement.processorSelection, "/deployment/placement/processorSelection", [
      "mode", "processorIds", "managerId", ...selectionControls
    ], errors, ["mode", "processorIds"]);
    checkStringArray(selection.processorIds, "/deployment/placement/processorSelection/processorIds", errors);
    checkOptionalString(selection.managerId, "/deployment/placement/processorSelection/managerId", errors);
  }
  checkStringArray(selection.excludeManagers, "/deployment/placement/processorSelection/excludeManagers", errors);
  checkDuplicateStrings(selection.excludeManagers, "/deployment/placement/processorSelection/excludeManagers", errors);
  if (selection.mode === "static") {
    checkDuplicateStrings(selection.processorIds, "/deployment/placement/processorSelection/processorIds", errors);
  }
  for (const key of ["allowUnknownManager", "requireScheduleClear", "requireConsumerAccess"]) {
    if (selection[key] !== undefined && typeof selection[key] !== "boolean") {
      errors.push({ code: "invalid_manifest", message: "must be a boolean", pointer: `/deployment/placement/processorSelection/${key}` });
    }
  }
  checkInteger(selection.maxHeartbeatAgeSeconds, "/deployment/placement/processorSelection/maxHeartbeatAgeSeconds", errors, 1);
  checkInteger(selection.candidateLimit, "/deployment/placement/processorSelection/candidateLimit", errors, 1, 4_294_967_295);
  checkInteger(selection.scanLimit, "/deployment/placement/processorSelection/scanLimit", errors, 1, 4_294_967_295);

  const lifecycle = checkObject(deployment.lifecycle, "/deployment/lifecycle", [
    "renewal", "update", "recovery"
  ], errors, ["renewal", "update", "recovery"]);
  const renewal = checkObject(lifecycle.renewal, "/deployment/lifecycle/renewal", ["mode", "leadTime"], errors, ["mode"]);
  checkEnum(renewal.mode, ["after_scheduled_end", "before_scheduled_end"], "/deployment/lifecycle/renewal/mode", errors);
  if (renewal.mode === "after_scheduled_end") {
    checkObject(lifecycle.renewal, "/deployment/lifecycle/renewal", ["mode"], errors, ["mode"]);
  } else if (renewal.mode === "before_scheduled_end") {
    checkObject(lifecycle.renewal, "/deployment/lifecycle/renewal", ["mode", "leadTime"], errors, ["mode", "leadTime"]);
    const lead = checkObject(renewal.leadTime, "/deployment/lifecycle/renewal/leadTime", ["mode", "durationMs", "profile"], errors, ["mode"]);
    checkEnum(lead.mode, ["fixed", "automatic"], "/deployment/lifecycle/renewal/leadTime/mode", errors);
    if (lead.mode === "fixed") {
      checkObject(renewal.leadTime, "/deployment/lifecycle/renewal/leadTime", ["mode", "durationMs"], errors, ["mode", "durationMs"]);
      const max = Math.min(1_800_000, typeof durationMs === "number" ? durationMs / 2 : 0);
      if (!Number.isSafeInteger(lead.durationMs) || (lead.durationMs as number) < 60_000 || (lead.durationMs as number) > max) {
        errors.push({ code: "invalid_manifest", message: `fixed durationMs must be in 60000..=${max}`, pointer: "/deployment/lifecycle/renewal/leadTime/durationMs" });
      }
    } else if (lead.mode === "automatic") {
      checkObject(renewal.leadTime, "/deployment/lifecycle/renewal/leadTime", ["mode", "profile"], errors, ["mode", "profile"]);
      if (lead.profile !== "proof.liskov.renewal-lead.v1") {
        errors.push({ code: "invalid_manifest", message: "automatic profile must be proof.liskov.renewal-lead.v1", pointer: "/deployment/lifecycle/renewal/leadTime/profile" });
      }
      errors.push({ code: "unsupported_policy_feature", message: "automatic renewal is not enabled", pointer: "/deployment/lifecycle/renewal/leadTime/mode" });
    }
  }
  const update = checkObject(lifecycle.update, "/deployment/lifecycle/update", ["timing", "existingJobs"], errors, ["timing", "existingJobs"]);
  checkEnum(update.timing, ["next_scheduled_renewal", "immediate"], "/deployment/lifecycle/update/timing", errors);
  const existingJobs = checkObject(update.existingJobs, "/deployment/lifecycle/update/existingJobs", ["mode", "trigger"], errors, ["mode"]);
  checkEnum(existingJobs.mode, ["run_until_scheduled_end", "cooperative_cease"], "/deployment/lifecycle/update/existingJobs/mode", errors);
  if (existingJobs.mode === "cooperative_cease") {
    checkObject(update.existingJobs, "/deployment/lifecycle/update/existingJobs", ["mode", "trigger"], errors, ["mode", "trigger"]);
    checkEnum(existingJobs.trigger, ["rollout_started", "successor_processor_claimed", "successor_runtime_ready"], "/deployment/lifecycle/update/existingJobs/trigger", errors);
  } else if (existingJobs.mode === "run_until_scheduled_end") {
    checkObject(update.existingJobs, "/deployment/lifecycle/update/existingJobs", ["mode"], errors, ["mode"]);
  }
  const recovery = checkObject(lifecycle.recovery, "/deployment/lifecycle/recovery", ["launch", "runtimeFailure"], errors, ["runtimeFailure"]);
  const launch = checkOptionalObject(recovery, "launch", "/deployment/lifecycle/recovery", ["maxRetries"], errors);
  if (launch.maxRetries !== undefined && (!Number.isSafeInteger(launch.maxRetries) || (launch.maxRetries as number) < 0 || (launch.maxRetries as number) > 10)) {
    errors.push({ code: "invalid_manifest", message: "maxRetries must be in 0..=10", pointer: "/deployment/lifecycle/recovery/launch/maxRetries" });
  }
  const runtimeFailure = checkObject(recovery.runtimeFailure, "/deployment/lifecycle/recovery/runtimeFailure", [
    "mode", "contactLossAfterMs", "restartGraceMs", "maxSameJobRestarts", "maxFreshRegistrationReplacements"
  ], errors, ["mode"]);
  checkEnum(runtimeFailure.mode, ["wait_until_scheduled_end", "replace_after_failure"], "/deployment/lifecycle/recovery/runtimeFailure/mode", errors);
  if (runtimeFailure.mode === "replace_after_failure") {
    errors.push({ code: "unsupported_policy_feature", message: "replacement after failure is not enabled", pointer: "/deployment/lifecycle/recovery/runtimeFailure/mode" });
    const bounds: Array<[string, number, number]> = [
      ["contactLossAfterMs", 120_000, 1_800_000],
      ["restartGraceMs", 0, 86_400_000],
      ["maxSameJobRestarts", 0, 50],
      ["maxFreshRegistrationReplacements", 0, 10]
    ];
    for (const [key, min, max] of bounds) {
      if (runtimeFailure[key] !== undefined
        && (!Number.isSafeInteger(runtimeFailure[key]) || (runtimeFailure[key] as number) < min || (runtimeFailure[key] as number) > max)) {
        errors.push({ code: "invalid_manifest", message: `${key} must be in ${min}..=${max}`, pointer: `/deployment/lifecycle/recovery/runtimeFailure/${key}` });
      }
    }
  } else if (runtimeFailure.mode === "wait_until_scheduled_end") {
    checkObject(recovery.runtimeFailure, "/deployment/lifecycle/recovery/runtimeFailure", ["mode"], errors, ["mode"]);
  }
  const spend = checkOptionalObject(deployment, "spend", "/deployment", [
    "maxRewardPlanckPerJob", "maxNativeFeePlanckPerJob", "maxServiceCreditMicrosPerGeneration"
  ], errors);
  checkOptionalString(spend.maxRewardPlanckPerJob, "/deployment/spend/maxRewardPlanckPerJob", errors);
  checkOptionalString(spend.maxNativeFeePlanckPerJob, "/deployment/spend/maxNativeFeePlanckPerJob", errors);
  checkInteger(spend.maxServiceCreditMicrosPerGeneration, "/deployment/spend/maxServiceCreditMicrosPerGeneration", errors, 0);

  const ingress = checkOptionalObject(root, "ingress", "", ["http", "ssh"], errors);
  const http = checkOptionalObject(ingress, "http", "/ingress", ["mode", "port", "healthPath"], errors, ["mode", "port"]);
  if (http.mode !== undefined) checkEnum(http.mode, ["disabled", "optional", "required"], "/ingress/http/mode", errors);
  if (ingress.http !== undefined) {
    checkInteger(http.port, "/ingress/http/port", errors, 0, 65_535, false);
  }
  checkOptionalString(http.healthPath, "/ingress/http/healthPath", errors);
  const ssh = checkOptionalObject(ingress, "ssh", "/ingress", ["mode", "provider"], errors, ["mode"]);
  if (ssh.mode !== undefined) checkEnum(ssh.mode, ["disabled", "optional", "required"], "/ingress/ssh/mode", errors);
  if (ingress.ssh !== undefined && (ssh.mode === "disabled" || ssh.mode === "optional")) {
    checkObject(ingress.ssh, "/ingress/ssh", ["mode"], errors, ["mode"]);
  } else if (ingress.ssh !== undefined && ssh.mode === "required") {
    checkObject(ingress.ssh, "/ingress/ssh", ["mode", "provider"], errors, ["mode", "provider"]);
    const rawProvider = object(ssh.provider);
    if (rawProvider?.kind === "liskov") {
      const provider = checkObject(ssh.provider, "/ingress/ssh/provider", ["kind", "authorizedKeys"], errors, ["kind", "authorizedKeys"]);
      checkManagedAuthorizedKeys(provider.authorizedKeys, errors);
    } else {
      const provider = checkObject(ssh.provider, "/ingress/ssh/provider", ["kind", "integrationId", "port"], errors, ["kind", "integrationId"]);
      checkEnum(provider.kind, ["tailscale"], "/ingress/ssh/provider/kind", errors);
      checkNonEmptyString(provider.integrationId, "/ingress/ssh/provider/integrationId", errors);
      if (provider.port !== undefined && provider.port !== 22) {
        errors.push({
          code: "invalid_manifest",
          message: "Tailscale Runtime SSH port must be 22",
          pointer: "/ingress/ssh/provider/port"
        });
      }
    }
  }
  if (http.mode === "optional" || ssh.mode === "optional") {
    errors.push({ code: "unsupported_policy_feature", message: "optional ingress is not enabled", pointer: "/ingress" });
  }
  const observability = checkOptionalObject(root, "observability", "", ["logs", "runtimeDiagnostics"], errors);
  const logs = checkOptionalObject(observability, "logs", "/observability", ["enabled", "profileId", "sinkName", "context"], errors);
  if (logs.enabled !== undefined && typeof logs.enabled !== "boolean") {
    errors.push({ code: "invalid_manifest", message: "must be a boolean", pointer: "/observability/logs/enabled" });
  }
  checkOptionalString(logs.profileId, "/observability/logs/profileId", errors);
  checkOptionalString(logs.sinkName, "/observability/logs/sinkName", errors);
  const context = object(logs.context);
  if (logs.context !== undefined && (!context || Object.values(context).some((entry) => typeof entry !== "string"))) {
    errors.push({ code: "invalid_manifest", message: "must be an object of string values", pointer: "/observability/logs/context" });
  }
  for (const field of ["profileId", "sinkName", "context"] as const) {
    if (Object.prototype.hasOwnProperty.call(logs, field)) {
      errors.push({
        code: "deprecated_manifest_field",
        message: `${field} is accepted for Manifest V4 compatibility but is deprecated; Liskov derives managed logging configuration automatically`,
        pointer: `/observability/logs/${field}`
      });
    }
  }
  const runtimeDiagnostics = checkOptionalObject(observability, "runtimeDiagnostics", "/observability", ["signed"], errors);
  if (runtimeDiagnostics.signed !== undefined && typeof runtimeDiagnostics.signed !== "boolean") {
    errors.push({ code: "invalid_manifest", message: "must be a boolean", pointer: "/observability/runtimeDiagnostics/signed" });
  }
  if (runtimeDiagnostics.signed !== undefined && runtimeDiagnostics.signed !== true) {
    errors.push({ code: "invalid_manifest", message: "signed runtime diagnostics cannot be disabled", pointer: "/observability/runtimeDiagnostics/signed" });
  }
  const configuration = checkOptionalObject(root, "configuration", "", ["variables", "secrets"], errors);
  const variables = checkArrayObjects(configuration.variables, "/configuration/variables", ["name", "required", "managed", "default"], errors, ["name"]);
  checkDuplicateKeys(variables, "name", "/configuration/variables", errors);
  for (const [index, variable] of variables.entries()) {
    checkNonEmptyString(variable.name, `/configuration/variables/${index}/name`, errors);
    checkOptionalString(variable.default, `/configuration/variables/${index}/default`, errors);
    for (const key of ["required", "managed"]) {
      if (variable[key] !== undefined && typeof variable[key] !== "boolean") {
        errors.push({ code: "invalid_manifest", message: "must be a boolean", pointer: `/configuration/variables/${index}/${key}` });
      }
    }
  }
  const secrets = checkArrayObjects(configuration.secrets, "/configuration/secrets", ["secretId", "required", "destination", "bundleId"], errors, ["secretId", "destination"]);
  checkDuplicateKeys(secrets, "secretId", "/configuration/secrets", errors);
  for (const [index, secret] of secrets.entries()) {
    checkNonEmptyString(secret.secretId, `/configuration/secrets/${index}/secretId`, errors);
    checkOptionalString(secret.bundleId, `/configuration/secrets/${index}/bundleId`, errors);
    if (secret.required !== undefined && typeof secret.required !== "boolean") {
      errors.push({ code: "invalid_manifest", message: "must be a boolean", pointer: `/configuration/secrets/${index}/required` });
    }
    const destination = checkObject(secret.destination, `/configuration/secrets/${index}/destination`, ["kind", "name", "path"], errors, ["kind"]);
    checkEnum(destination.kind, ["env", "file"], `/configuration/secrets/${index}/destination/kind`, errors);
    if (destination.kind === "env") {
      checkObject(secret.destination, `/configuration/secrets/${index}/destination`, ["kind", "name"], errors, ["kind", "name"]);
      checkOptionalString(destination.name, `/configuration/secrets/${index}/destination/name`, errors);
    } else if (destination.kind === "file") {
      checkObject(secret.destination, `/configuration/secrets/${index}/destination`, ["kind", "path"], errors, ["kind", "path"]);
      checkOptionalString(destination.path, `/configuration/secrets/${index}/destination/path`, errors);
    }
  }
  return errors;
}
