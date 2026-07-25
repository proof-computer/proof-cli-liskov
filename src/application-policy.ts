export const APPLICATION_POLICY_SCHEMA = "proof.liskov.application-policy";
export const APPLICATION_POLICY_VERSION = 4;
export const ATTESTED_RUNTIME_PROFILE = "proof.liskov.attested-runtime.v1";

export interface PolicyValidationError {
  code: "invalid_policy" | "unknown_field" | "unsupported_policy_feature" | "entitlement_exceeded";
  message: string;
  pointer: string;
}

export interface PolicyMigrationWarning {
  level: "warning";
  code: string;
  message: string;
  pointer: string;
}

type JsonObject = Record<string, unknown>;

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
    errors.push({ code: "invalid_policy", message: "must be an object", pointer: at });
    return {};
  }
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) {
      errors.push({ code: "unknown_field", message: `unknown field ${key}`, pointer: pointer(at, key) });
    }
  }
  for (const key of required) {
    if (!(key in result)) {
      errors.push({ code: "invalid_policy", message: `missing required field ${key}`, pointer: pointer(at, key) });
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
    errors.push({ code: "invalid_policy", message: `must be one of ${allowed.join(", ")}`, pointer: at });
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
    errors.push({ code: "invalid_policy", message: "must be an array", pointer: at });
    return [];
  }
  return value.map((item, index) => checkObject(item, `${at}/${index}`, allowed, errors, required));
}

function checkOptionalString(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (value !== undefined && typeof value !== "string") {
    errors.push({ code: "invalid_policy", message: "must be a string", pointer: at });
  }
}

function checkStringArray(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push({ code: "invalid_policy", message: "must be an array of strings", pointer: at });
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
    errors.push({ code: "invalid_policy", message: `must be an integer in ${min}..=${max}`, pointer: at });
  }
}

export function validateApplicationPolicyV4(value: unknown): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const root = checkObject(value, "", [
    "schema", "schemaVersion", "applicationId", "applicationUid", "metadata",
    "artifact", "build", "runtime", "deployment", "ingress", "observability", "configuration"
  ], errors, ["schema", "schemaVersion", "applicationId", "deployment"]);
  if (root.schema !== APPLICATION_POLICY_SCHEMA) {
    errors.push({ code: "invalid_policy", message: `schema must be ${APPLICATION_POLICY_SCHEMA}`, pointer: "/schema" });
  }
  if (root.schemaVersion !== APPLICATION_POLICY_VERSION) {
    errors.push({ code: "invalid_policy", message: "schemaVersion must be 4", pointer: "/schemaVersion" });
  }
  if (typeof root.applicationId !== "string" || !root.applicationId.trim()) {
    errors.push({ code: "invalid_policy", message: "applicationId must be non-empty", pointer: "/applicationId" });
  }
  if (root.applicationUid !== undefined && (typeof root.applicationUid !== "string" || !root.applicationUid.trim())) {
    errors.push({ code: "invalid_policy", message: "applicationUid must be non-empty when present", pointer: "/applicationUid" });
  }

  const metadata = checkOptionalObject(root, "metadata", "", ["appType", "labels", "description"], errors);
  checkOptionalString(metadata.appType, "/metadata/appType", errors);
  checkOptionalString(metadata.description, "/metadata/description", errors);
  checkStringArray(metadata.labels, "/metadata/labels", errors);
  const artifact = checkOptionalObject(root, "artifact", "", ["kind", "cid", "digest", "encryption", "runtimeImage"], errors);
  if (artifact.kind !== undefined) checkEnum(artifact.kind, ["ipfs", "runtime_image"], "/artifact/kind", errors);
  for (const key of ["cid", "digest", "runtimeImage"]) checkOptionalString(artifact[key], `/artifact/${key}`, errors);
  const encryption = checkOptionalObject(artifact, "encryption", "/artifact", ["mode"], errors);
  if (encryption.mode !== undefined) checkEnum(encryption.mode, ["none", "aes256_gcm"], "/artifact/encryption/mode", errors);
  const build = checkOptionalObject(root, "build", "", ["github"], errors);
  const github = checkOptionalObject(build, "github", "/build", ["repository", "allowedRefs", "workflowRef", "path"], errors, ["repository"]);
  for (const key of ["repository", "workflowRef", "path"]) checkOptionalString(github[key], `/build/github/${key}`, errors);
  checkStringArray(github.allowedRefs, "/build/github/allowedRefs", errors);

  const runtime = checkOptionalObject(root, "runtime", "", ["engine", "command", "role", "resources", "requiredModules", "bootstrap"], errors);
  if (runtime.engine !== undefined) checkEnum(runtime.engine, ["nodejs", "deno", "bun"], "/runtime/engine", errors);
  checkOptionalString(runtime.command, "/runtime/command", errors);
  checkOptionalString(runtime.role, "/runtime/role", errors);
  checkStringArray(runtime.requiredModules, "/runtime/requiredModules", errors);
  const resources = checkOptionalObject(runtime, "resources", "/runtime", ["memoryMiB", "storageMiB", "networkRequestQuota"], errors);
  for (const key of ["memoryMiB", "storageMiB", "networkRequestQuota"]) {
    checkInteger(resources[key], `/runtime/resources/${key}`, errors, 0);
  }
  const bootstrap = checkOptionalObject(runtime, "bootstrap", "/runtime", [
    "trustProfile", "signedDiagnosticsRequired", "identityBoundSecretsRequired"
  ], errors);
  if (bootstrap.trustProfile !== undefined && bootstrap.trustProfile !== ATTESTED_RUNTIME_PROFILE) {
    errors.push({ code: "invalid_policy", message: "attested runtime trust is mandatory", pointer: "/runtime/bootstrap/trustProfile" });
  }
  for (const key of ["signedDiagnosticsRequired", "identityBoundSecretsRequired"]) {
    if (bootstrap[key] !== undefined && bootstrap[key] !== true) {
      errors.push({ code: "invalid_policy", message: `${key} cannot be disabled`, pointer: `/runtime/bootstrap/${key}` });
    }
  }

  const deployment = checkObject(root.deployment, "/deployment", [
    "parallelism", "schedule", "placement", "lifecycle", "spend"
  ], errors, ["parallelism", "schedule", "lifecycle"]);
  const parallelism = deployment.parallelism;
  if (!Number.isSafeInteger(parallelism) || (parallelism as number) < 1 || (parallelism as number) > 64) {
    errors.push({ code: "invalid_policy", message: "parallelism must be an integer in 1..=64", pointer: "/deployment/parallelism" });
  } else if ((parallelism as number) > 1) {
    errors.push({ code: "unsupported_policy_feature", message: "parallelism above 1 is not enabled", pointer: "/deployment/parallelism" });
    errors.push({ code: "entitlement_exceeded", message: "parallelism exceeds the default entitlement", pointer: "/deployment/parallelism" });
  }
  const schedule = checkObject(deployment.schedule, "/deployment/schedule", [
    "durationMs", "startDelayMs", "maxStartDelayMs"
  ], errors, ["durationMs"]);
  const durationMs = schedule.durationMs;
  if (!Number.isSafeInteger(durationMs) || (durationMs as number) <= 0) {
    errors.push({ code: "invalid_policy", message: "durationMs must be a positive integer", pointer: "/deployment/schedule/durationMs" });
  }
  checkInteger(schedule.startDelayMs, "/deployment/schedule/startDelayMs", errors, 0);
  checkInteger(schedule.maxStartDelayMs, "/deployment/schedule/maxStartDelayMs", errors, 0);
  if (typeof schedule.startDelayMs === "number" && typeof schedule.maxStartDelayMs === "number"
    && schedule.startDelayMs > schedule.maxStartDelayMs) {
    errors.push({ code: "invalid_policy", message: "startDelayMs cannot exceed maxStartDelayMs", pointer: "/deployment/schedule/startDelayMs" });
  }

  const placement = checkOptionalObject(deployment, "placement", "/deployment", [
    "requirements", "groups", "topologyConstraints", "processorSelection"
  ], errors);
  const requirements = checkOptionalObject(placement, "requirements", "/deployment/placement", [
    "trustProfile", "machine", "evidence"
  ], errors);
  if (requirements.trustProfile !== undefined && requirements.trustProfile !== ATTESTED_RUNTIME_PROFILE) {
    errors.push({ code: "invalid_policy", message: "placement trust profile cannot be weakened", pointer: "/deployment/placement/requirements/trustProfile" });
  }
  const machine = checkOptionalObject(requirements, "machine", "/deployment/placement/requirements", [
    "class", "profileVersion", "minimums"
  ], errors);
  checkOptionalString(machine.class, "/deployment/placement/requirements/machine/class", errors);
  checkOptionalString(machine.profileVersion, "/deployment/placement/requirements/machine/profileVersion", errors);
  const minimums = object(machine.minimums);
  if (machine.minimums !== undefined && !minimums) {
    errors.push({ code: "invalid_policy", message: "must be an object", pointer: "/deployment/placement/requirements/machine/minimums" });
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
        errors.push({ code: "invalid_policy", message: "standard must be ISO-3166-1-alpha-2", pointer: `${geographyAt}/standard` });
      }
      if (Array.isArray(geography.values) && (geography.values.length === 0
        || geography.values.some((entry) => typeof entry !== "string" || !/^[A-Z]{2}$/.test(entry)))) {
        errors.push({ code: "invalid_policy", message: "country values must be uppercase ISO alpha-2 codes", pointer: `${geographyAt}/values` });
      }
    } else if (geography.kind === "region") {
      checkObject(group.geography, geographyAt, ["kind", "catalog", "values"], errors, ["kind", "catalog", "values"]);
      if (typeof geography.catalog !== "string" || !geography.catalog.trim()) {
        errors.push({ code: "invalid_policy", message: "catalog must be a non-empty string", pointer: `${geographyAt}/catalog` });
      }
      if (Array.isArray(geography.values) && geography.values.length === 0) {
        errors.push({ code: "invalid_policy", message: "region values cannot be empty", pointer: `${geographyAt}/values` });
      }
    }
  }
  if (groups.length > 0) {
    errors.push({ code: "unsupported_policy_feature", message: "counted placement groups are not enabled", pointer: "/deployment/placement/groups" });
    const sum = groups.reduce((total, group) => total + (typeof group.count === "number" ? group.count : 0), 0);
    if (typeof parallelism === "number" && sum !== parallelism) {
      errors.push({ code: "invalid_policy", message: "placement group counts must sum to parallelism", pointer: "/deployment/placement/groups" });
    }
  }
  const topology = checkArrayObjects(placement.topologyConstraints, "/deployment/placement/topologyConstraints", [
    "kind", "scope", "topologyKey", "strength"
  ], errors, ["kind", "scope", "topologyKey", "strength"]);
  if (topology.length > 0) {
    errors.push({ code: "unsupported_policy_feature", message: "topology constraints are not enabled", pointer: "/deployment/placement/topologyConstraints" });
  }
  for (const [index, constraint] of topology.entries()) {
    const at = `/deployment/placement/topologyConstraints/${index}`;
    checkEnum(constraint.kind, ["affinity", "anti_affinity"], `${at}/kind`, errors);
    checkEnum(constraint.scope, ["this_deployment"], `${at}/scope`, errors);
    checkEnum(constraint.topologyKey, ["processor", "operator", "manager", "country", "region"], `${at}/topologyKey`, errors);
    checkEnum(constraint.strength, ["required", "preferred"], `${at}/strength`, errors);
  }
  const selection = checkOptionalObject(placement, "processorSelection", "/deployment/placement", [
    "mode", "managerId", "processorIds", "requireScheduleClear", "requireConsumerAccess", "candidateLimit"
  ], errors);
  if (selection.mode !== undefined) checkEnum(selection.mode, ["open_market", "manager", "static"], "/deployment/placement/processorSelection/mode", errors);
  if (selection.mode === "open_market") {
    checkObject(placement.processorSelection, "/deployment/placement/processorSelection", ["mode"], errors, ["mode"]);
  } else if (selection.mode === "manager") {
    checkObject(placement.processorSelection, "/deployment/placement/processorSelection", ["mode", "managerId"], errors, ["mode", "managerId"]);
    if (typeof selection.managerId !== "string" || !selection.managerId.trim()) {
      errors.push({ code: "invalid_policy", message: "managerId must be non-empty", pointer: "/deployment/placement/processorSelection/managerId" });
    }
  } else if (selection.mode === "static") {
    checkObject(placement.processorSelection, "/deployment/placement/processorSelection", [
      "mode", "processorIds", "managerId", "requireScheduleClear", "requireConsumerAccess", "candidateLimit"
    ], errors, ["mode", "processorIds"]);
    checkStringArray(selection.processorIds, "/deployment/placement/processorSelection/processorIds", errors);
    checkOptionalString(selection.managerId, "/deployment/placement/processorSelection/managerId", errors);
    for (const key of ["requireScheduleClear", "requireConsumerAccess"]) {
      if (selection[key] !== undefined && typeof selection[key] !== "boolean") {
        errors.push({ code: "invalid_policy", message: "must be a boolean", pointer: `/deployment/placement/processorSelection/${key}` });
      }
    }
    checkInteger(selection.candidateLimit, "/deployment/placement/processorSelection/candidateLimit", errors, 1, 4_294_967_295);
  }

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
        errors.push({ code: "invalid_policy", message: `fixed durationMs must be in 60000..=${max}`, pointer: "/deployment/lifecycle/renewal/leadTime/durationMs" });
      }
    } else if (lead.mode === "automatic") {
      checkObject(renewal.leadTime, "/deployment/lifecycle/renewal/leadTime", ["mode", "profile"], errors, ["mode", "profile"]);
      if (lead.profile !== "proof.liskov.renewal-lead.v1") {
        errors.push({ code: "invalid_policy", message: "automatic profile must be proof.liskov.renewal-lead.v1", pointer: "/deployment/lifecycle/renewal/leadTime/profile" });
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
    errors.push({ code: "invalid_policy", message: "maxRetries must be in 0..=10", pointer: "/deployment/lifecycle/recovery/launch/maxRetries" });
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
        errors.push({ code: "invalid_policy", message: `${key} must be in ${min}..=${max}`, pointer: `/deployment/lifecycle/recovery/runtimeFailure/${key}` });
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
  const ssh = checkOptionalObject(ingress, "ssh", "/ingress", ["mode", "port"], errors, ["mode"]);
  if (ssh.mode !== undefined) checkEnum(ssh.mode, ["disabled", "optional", "required"], "/ingress/ssh/mode", errors);
  checkInteger(ssh.port, "/ingress/ssh/port", errors, 0, 65_535);
  if (http.mode === "optional" || ssh.mode === "optional") {
    errors.push({ code: "unsupported_policy_feature", message: "optional ingress is not enabled", pointer: "/ingress" });
  }
  if (ingress.http !== undefined && ingress.ssh !== undefined) {
    errors.push({ code: "unsupported_policy_feature", message: "simultaneous HTTP and SSH ingress is not enabled", pointer: "/ingress" });
  }
  const observability = checkOptionalObject(root, "observability", "", ["logs", "runtimeDiagnostics"], errors);
  const logs = checkOptionalObject(observability, "logs", "/observability", ["enabled", "profileId", "sinkName", "context"], errors);
  if (logs.enabled !== undefined && typeof logs.enabled !== "boolean") {
    errors.push({ code: "invalid_policy", message: "must be a boolean", pointer: "/observability/logs/enabled" });
  }
  checkOptionalString(logs.profileId, "/observability/logs/profileId", errors);
  checkOptionalString(logs.sinkName, "/observability/logs/sinkName", errors);
  const context = object(logs.context);
  if (logs.context !== undefined && (!context || Object.values(context).some((entry) => typeof entry !== "string"))) {
    errors.push({ code: "invalid_policy", message: "must be an object of string values", pointer: "/observability/logs/context" });
  }
  const runtimeDiagnostics = checkOptionalObject(observability, "runtimeDiagnostics", "/observability", ["signed"], errors);
  if (runtimeDiagnostics.signed !== undefined && typeof runtimeDiagnostics.signed !== "boolean") {
    errors.push({ code: "invalid_policy", message: "must be a boolean", pointer: "/observability/runtimeDiagnostics/signed" });
  }
  if (runtimeDiagnostics.signed !== undefined && runtimeDiagnostics.signed !== true) {
    errors.push({ code: "invalid_policy", message: "signed runtime diagnostics cannot be disabled", pointer: "/observability/runtimeDiagnostics/signed" });
  }
  const configuration = checkOptionalObject(root, "configuration", "", ["variables", "secrets"], errors);
  const variables = checkArrayObjects(configuration.variables, "/configuration/variables", ["name", "required", "managed", "default"], errors, ["name"]);
  for (const [index, variable] of variables.entries()) {
    checkOptionalString(variable.name, `/configuration/variables/${index}/name`, errors);
    checkOptionalString(variable.default, `/configuration/variables/${index}/default`, errors);
    for (const key of ["required", "managed"]) {
      if (variable[key] !== undefined && typeof variable[key] !== "boolean") {
        errors.push({ code: "invalid_policy", message: "must be a boolean", pointer: `/configuration/variables/${index}/${key}` });
      }
    }
  }
  const secrets = checkArrayObjects(configuration.secrets, "/configuration/secrets", ["secretId", "required", "destination", "bundleId"], errors, ["secretId", "destination"]);
  for (const [index, secret] of secrets.entries()) {
    checkOptionalString(secret.secretId, `/configuration/secrets/${index}/secretId`, errors);
    checkOptionalString(secret.bundleId, `/configuration/secrets/${index}/bundleId`, errors);
    if (secret.required !== undefined && typeof secret.required !== "boolean") {
      errors.push({ code: "invalid_policy", message: "must be a boolean", pointer: `/configuration/secrets/${index}/required` });
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

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefined);
  const source = object(value);
  if (!source) return value;
  return Object.fromEntries(Object.entries(source)
    .filter(([, entry]) => entry !== undefined)
    .map(([key, entry]) => [key, removeUndefined(entry)]));
}

export function migrateApplicationPolicyV3(value: unknown): {
  policy: JsonObject;
  warnings: PolicyMigrationWarning[];
} {
  const v3 = object(value);
  if (!v3 || v3.domain !== "proof.slipway.application-policy.v3") {
    throw new Error("input must be a proof.slipway.application-policy.v3 object");
  }
  const applicationId = typeof v3.applicationId === "string" ? v3.applicationId.trim() : "";
  if (!applicationId) throw new Error("v3 applicationId is required");
  const runtime = object(v3.runtime) ?? {};
  const acurast = object(v3.acurast) ?? {};
  const artifact = object(v3.artifact) ?? {};
  const recovery = object(acurast.recovery) ?? {};
  const metadata = object(v3.metadata) ?? {};
  const resources = object(runtime.resources) ?? {};
  const automation = object(object(v3.artifactAutomation)?.github);
  const source = object(v3.source) ?? {};
  const selection = object(acurast.processorSelection) ?? {};
  const budgetCaps = object(acurast.budgetCaps) ?? {};
  const blackbox = object(v3.blackbox) ?? {};
  const durationMs = typeof runtime.durationMs === "number" ? runtime.durationMs : 1_800_000;
  const maxRetries = typeof recovery.maxAutoRetries === "number" ? recovery.maxAutoRetries : 5;
  const maxRuntimeReplaces = typeof recovery.maxRuntimeReplaces === "number"
    ? recovery.maxRuntimeReplaces
    : 2;
  const pinnedProcessors = Array.isArray(acurast.pinnedProcessors)
    ? acurast.pinnedProcessors.filter((entry): entry is string => typeof entry === "string")
    : [];
  const processorSelection = selection.mode === "static" || pinnedProcessors.length > 0
    ? {
        mode: "static",
        processorIds: pinnedProcessors,
        managerId: acurast.managerId,
        requireScheduleClear: selection.requireScheduleClear === true,
        requireConsumerAccess: selection.requireConsumerAccess === true,
        candidateLimit: selection.candidateLimit
      }
    : selection.mode === "manager"
      ? { mode: "manager", managerId: acurast.managerId }
      : { mode: "open_market" };
  const githubBuild = automation
    ? {
        repository: typeof automation.repository === "string" ? automation.repository : source.repository,
        allowedRefs: Array.isArray(automation.allowedRefs)
          ? automation.allowedRefs.filter((entry): entry is string => typeof entry === "string")
          : (typeof automation.ref === "string" ? [automation.ref] : []),
        workflowRef: automation.workflowRef,
        path: source.path
      }
    : undefined;
  const variables = (Array.isArray(object(v3.environment)?.variables)
    ? object(v3.environment)?.variables as unknown[]
    : []).flatMap((entry) => {
      const variable = object(entry);
      if (!variable || typeof variable.name !== "string") return [];
      return [{
        name: variable.name,
        required: variable.required === true,
        managed: variable.source === "managed",
        default: typeof variable.value === "string" ? variable.value : undefined
      }];
    });
  const secrets = (Array.isArray(object(v3.secrets)?.declarations)
    ? object(v3.secrets)?.declarations as unknown[]
    : []).flatMap((entry) => {
      const secret = object(entry);
      if (!secret || typeof secret.secretId !== "string" || typeof secret.name !== "string") return [];
      return [{
        secretId: secret.secretId,
        required: secret.required !== false,
        destination: secret.target === "file"
          ? { kind: "file", path: secret.name }
          : { kind: "env", name: secret.name },
        bundleId: secret.bundleId
      }];
    });
  const policy = removeUndefined({
    schema: APPLICATION_POLICY_SCHEMA,
    schemaVersion: 4,
    applicationId,
    applicationUid: v3.applicationUid,
    metadata: {
      appType: metadata.appType,
      labels: Array.isArray(metadata.labels) ? metadata.labels : [],
      description: metadata.description
    },
    artifact: {
      kind: artifact.mode === "runtime-image" ? "runtime_image" : "ipfs",
      cid: artifact.cid,
      digest: artifact.digest,
      runtimeImage: artifact.runtimeImage,
      encryption: { mode: artifact.requiredEncryptionMode === "aes-256-gcm" ? "aes256_gcm" : "none" }
    },
    build: { github: githubBuild },
    runtime: {
      engine: ["deno", "bun"].includes(String(runtime.runtime)) ? runtime.runtime : "nodejs",
      command: runtime.command,
      role: runtime.role,
      requiredModules: Array.isArray(runtime.requiredModules) ? runtime.requiredModules : [],
      resources: {
        memoryMiB: resources.memory,
        storageMiB: resources.storage,
        networkRequestQuota: resources.networkRequests
      },
      bootstrap: {
        trustProfile: ATTESTED_RUNTIME_PROFILE,
        signedDiagnosticsRequired: true,
        identityBoundSecretsRequired: true
      }
    },
    deployment: {
      parallelism: typeof runtime.desiredCount === "number" ? runtime.desiredCount : 1,
      schedule: {
        durationMs,
        startDelayMs: acurast.startDelayMs,
        maxStartDelayMs: acurast.maxStartDelayMs
      },
      placement: {
        requirements: { trustProfile: ATTESTED_RUNTIME_PROFILE },
        processorSelection
      },
      lifecycle: {
        renewal: { mode: "after_scheduled_end" },
        update: {
          timing: "immediate",
          existingJobs: { mode: "run_until_scheduled_end" }
        },
        recovery: {
          launch: { maxRetries },
          runtimeFailure: maxRuntimeReplaces === 0
            ? { mode: "wait_until_scheduled_end" }
            : {
                mode: "replace_after_failure",
                contactLossAfterMs: 300_000,
                restartGraceMs: 600_000,
                maxSameJobRestarts: 3,
                maxFreshRegistrationReplacements: maxRuntimeReplaces
              }
        }
      },
      spend: {
        maxRewardPlanckPerJob: budgetCaps.maxRewardPerLaunch === undefined
          ? undefined
          : String(budgetCaps.maxRewardPerLaunch),
        maxNativeFeePlanckPerJob: budgetCaps.maxNativeFeePerLaunch === undefined
          ? undefined
          : String(budgetCaps.maxNativeFeePerLaunch)
      }
    },
    ingress: {},
    observability: {
      logs: {
        enabled: blackbox.enabled === true,
        profileId: blackbox.profileId,
        sinkName: blackbox.sinkName,
        context: object(blackbox.context) ?? {}
      },
      runtimeDiagnostics: { signed: true }
    },
    configuration: { variables, secrets }
  }) as JsonObject;
  const warnings: PolicyMigrationWarning[] = [
    {
      level: "warning",
      code: "mandatory_trust_added",
      message: "v4 requires proof.liskov.attested-runtime.v1 and signed diagnostics",
      pointer: "/runtime/bootstrap"
    },
    {
      level: "warning",
      code: "legacy_renewal_after_end",
      message: "v3 renewal is migrated to after_scheduled_end",
      pointer: "/deployment/lifecycle/renewal"
    },
    {
      level: "warning",
      code: "server_metadata_removed",
      message: "display name, ownership, publication metadata, signatures, and provenance remain server-owned",
      pointer: "/metadata"
    }
  ];
  if (runtime.replacementRunwayMs !== undefined || runtime.replacementHandoff !== undefined) {
    warnings.push({
      level: "warning",
      code: "legacy_replacement_runway_ignored",
      message: "replacementRunwayMs/replacementHandoff are not migrated",
      pointer: "/runtime/replacementRunwayMs"
    });
  }
  if (automation?.autoPublish !== undefined) {
    warnings.push({
      level: "warning",
      code: "automatic_publication_removed",
      message: "build.github is preserved, but publication remains a separate server-authorized action",
      pointer: "/artifactAutomation/github/autoPublish"
    });
  }
  if (maxRuntimeReplaces > 0) {
    warnings.push({
      level: "warning",
      code: "runtime_recovery_review_required",
      message: "the v3 replacement cap was expanded into explicit v4 recovery defaults and remains capability-gated",
      pointer: "/deployment/lifecycle/recovery/runtimeFailure"
    });
  }
  return { policy, warnings };
}
