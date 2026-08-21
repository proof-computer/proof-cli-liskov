import type { PolicyValidationError } from "./application-policy.js";

export const APPLICATION_MANIFEST_SCHEMA = "proof.liskov.application-manifest";
export const APPLICATION_MANIFEST_VERSION_V5 = 5;

type JsonObject = Record<string, unknown>;

const DURATION = /^(0|[1-9][0-9]*)(ms|s|m|h|d)$/u;
const BYTE_SIZE = /^(0|[1-9][0-9]*)(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)$/u;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const APPLICATION_ID = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/u;
const SECRET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/u;
const MICROS = /^(0|[1-9][0-9]{0,24})$/u;
const ABSOLUTE_PATH = /^\/[^\u0000]{1,255}$/u;
const IMAGE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const IMAGE_VERSION = /^[0-9]+(\.[0-9]+){0,2}$/u;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,62}$/u;
const UTC_INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u;
const ARTIFACT_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;

const ROOT_ALLOWED = [
  "schema",
  "schemaVersion",
  "applicationId",
  "metadata",
  "release",
  "runtime",
  "execution",
  "deployment",
  "access",
  "configuration",
  "observability",
  "state",
  "debug"
] as const;

const DEFERRED_ROOT: Record<string, string> = {
  ingress: "public ingress is deferred from thin V5",
  cohort: "cohort/hooks are deferred from thin V5",
  hooks: "cohort/hooks are deferred from thin V5",
  integrations: "integrations are deferred from thin V5"
};

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function pointer(parent: string, child: string): string {
  const encoded = child.replaceAll("~", "~0").replaceAll("/", "~1");
  return parent === "" ? `/${encoded}` : `${parent}/${encoded}`;
}

function deferred(message: string, at: string): PolicyValidationError {
  return { code: "unsupported_policy_feature", message, pointer: at };
}

function invalid(message: string, at: string): PolicyValidationError {
  return { code: "invalid_manifest", message, pointer: at };
}

function unknownField(at: string, message = "unknown field"): PolicyValidationError {
  return { code: "unknown_field", message, pointer: at };
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
    errors.push(invalid("must be an object", at));
    return {};
  }
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) {
      const deferredMessage = DEFERRED_ROOT[key];
      if (deferredMessage && at === "") {
        errors.push(unknownField(pointer(at, key), deferredMessage));
      } else {
        errors.push(unknownField(pointer(at, key)));
      }
    }
  }
  for (const key of required) {
    if (!(key in result) || result[key] === undefined) {
      errors.push(invalid(`missing required field ${key}`, pointer(at, key) === "/" ? `/${key}` : pointer(at, key)));
    }
  }
  return result;
}

function checkPattern(value: unknown, pattern: RegExp, at: string, errors: PolicyValidationError[], message: string): void {
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(invalid(message, at));
  }
}

function checkDuration(value: unknown, at: string, errors: PolicyValidationError[]): void {
  checkPattern(value, DURATION, at, errors, "must be a duration like 10m, 1h, or 1d");
}

function checkMicros(value: unknown, at: string, errors: PolicyValidationError[]): void {
  checkPattern(value, MICROS, at, errors, "must be a decimal string of micros, not a JSON number");
}

function checkJobCount(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 256) {
    errors.push(invalid("must be an integer in 1..=256", at));
  }
}

function checkUtc(value: unknown, at: string, errors: PolicyValidationError[]): void {
  if (value === undefined || value === null) return;
  checkPattern(value, UTC_INSTANT, at, errors, "must be YYYY-MM-DDTHH:MM:SSZ");
}

export function validateApplicationManifestV5(value: unknown): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const root = checkObject(value, "", ROOT_ALLOWED, errors, [
    "schema",
    "schemaVersion",
    "applicationId",
    "release",
    "runtime",
    "execution",
    "deployment",
    "state"
  ]);
  if (root.schema !== APPLICATION_MANIFEST_SCHEMA) {
    errors.push(invalid(`schema must be ${APPLICATION_MANIFEST_SCHEMA}`, "/schema"));
  }
  if (root.schemaVersion !== APPLICATION_MANIFEST_VERSION_V5) {
    errors.push(invalid("schemaVersion must be 5", "/schemaVersion"));
  }
  checkPattern(root.applicationId, APPLICATION_ID, "/applicationId", errors, "applicationId must be a lowercase slug");

  if (root.metadata !== undefined && root.metadata !== null) {
    const metadata = checkObject(root.metadata, "/metadata", ["description", "labels"], errors);
    if (metadata.description !== undefined && metadata.description !== null && typeof metadata.description !== "string") {
      errors.push(invalid("must be a string", "/metadata/description"));
    }
    if (metadata.labels !== undefined && metadata.labels !== null) {
      if (!Array.isArray(metadata.labels)) {
        errors.push(invalid("must be an array of labels", "/metadata/labels"));
      } else {
        metadata.labels.forEach((label, index) => {
          checkPattern(label, LABEL, `/metadata/labels/${index}`, errors, "must be a lowercase label");
        });
      }
    }
  }

  validateRelease(root.release, errors);
  validateRuntime(root.runtime, errors);
  validateExecution(root.execution, errors);
  validateDeployment(root.deployment, errors);
  if (root.access !== undefined && root.access !== null) validateAccess(root.access, errors);
  if (root.configuration !== undefined && root.configuration !== null) validateConfiguration(root.configuration, errors);
  if (root.observability !== undefined && root.observability !== null) validateObservability(root.observability, errors);
  validateState(root.state, errors);
  if (root.debug !== undefined && root.debug !== null) {
    const debug = checkObject(root.debug, "/debug", ["holdOnFailure"], errors);
    if (debug.holdOnFailure !== undefined && debug.holdOnFailure !== null && typeof debug.holdOnFailure !== "boolean") {
      errors.push(invalid("must be a boolean", "/debug/holdOnFailure"));
    }
  }
  return errors;
}

function validateRelease(value: unknown, errors: PolicyValidationError[]): void {
  const release = object(value);
  if (!release) {
    errors.push(invalid("must be an object", "/release"));
    return;
  }
  if (release.mode === "source") {
    checkObject(value, "/release", ["mode"], errors, ["mode"]);
    return;
  }
  if (release.mode === "pinned") {
    const pinned = checkObject(value, "/release", ["mode", "artifact"], errors, ["mode", "artifact"]);
    const artifact = checkObject(pinned.artifact, "/release/artifact", ["digest"], errors, ["digest"]);
    checkPattern(artifact.digest, SHA256, "/release/artifact/digest", errors, "must be sha256: followed by 64 lowercase hex characters");
    return;
  }
  checkObject(value, "/release", ["mode", "artifact"], errors, ["mode"]);
  errors.push(invalid("release.mode must be source or pinned", "/release/mode"));
}

function validateRuntime(value: unknown, errors: PolicyValidationError[]): void {
  const runtime = object(value);
  if (!runtime) {
    errors.push(invalid("must be an object", "/runtime"));
    return;
  }
  if (runtime.kind === "javascript") {
    const js = checkObject(value, "/runtime", ["kind", "engine", "entrypoint"], errors, ["kind", "entrypoint"]);
    if (js.engine !== undefined && js.engine !== null && js.engine !== "nodejs") {
      errors.push(invalid("javascript engine must be nodejs", "/runtime/engine"));
    }
    const entry = checkObject(js.entrypoint, "/runtime/entrypoint", ["file"], errors, ["file"]);
    checkPattern(entry.file, ARTIFACT_RELATIVE, "/runtime/entrypoint/file", errors, "must be a relative artifact path");
    return;
  }
  if (runtime.kind === "native_image") {
    const native = checkObject(value, "/runtime", ["kind", "image", "entrypoint"], errors, ["kind", "image", "entrypoint"]);
    const image = checkObject(native.image, "/runtime/image", ["catalog", "name", "version"], errors, ["name", "version"]);
    if (image.catalog !== undefined && image.catalog !== null) {
      checkPattern(image.catalog, IMAGE_NAME, "/runtime/image/catalog", errors, "must be a catalogue name");
    }
    checkPattern(image.name, IMAGE_NAME, "/runtime/image/name", errors, "must be an image name");
    checkPattern(image.version, IMAGE_VERSION, "/runtime/image/version", errors, "must be a version floor like 0.1");
    const entry = checkObject(native.entrypoint, "/runtime/entrypoint", ["executable", "args"], errors, ["executable"]);
    checkPattern(entry.executable, ABSOLUTE_PATH, "/runtime/entrypoint/executable", errors, "must be an absolute in-image path");
    if (entry.args !== undefined) {
      if (!Array.isArray(entry.args) || entry.args.some((item) => typeof item !== "string")) {
        errors.push(invalid("args must be an array of strings", "/runtime/entrypoint/args"));
      }
    }
    return;
  }
  checkObject(value, "/runtime", ["kind"], errors, ["kind"]);
  errors.push(invalid("runtime.kind must be javascript or native_image", "/runtime/kind"));
}

function validateExecution(value: unknown, errors: PolicyValidationError[]): void {
  const execution = object(value);
  if (!execution) {
    errors.push(invalid("must be an object", "/execution"));
    return;
  }
  if (execution.mode === "once") {
    checkObject(value, "/execution", ["mode"], errors, ["mode"]);
    return;
  }
  if (execution.mode === "continuous") {
    const continuous = checkObject(value, "/execution", ["mode", "until"], errors, ["mode"]);
    checkUtc(continuous.until, "/execution/until", errors);
    return;
  }
  if (execution.mode === "interval") {
    const interval = checkObject(value, "/execution", ["mode", "every", "until"], errors, ["mode", "every"]);
    checkDuration(interval.every, "/execution/every", errors);
    checkUtc(interval.until, "/execution/until", errors);
    return;
  }
  checkObject(value, "/execution", ["mode"], errors, ["mode"]);
  errors.push(invalid("execution.mode must be once, continuous, or interval", "/execution/mode"));
}

function validateDeployment(value: unknown, errors: PolicyValidationError[]): void {
  const deployment = checkObject(value, "/deployment", [
    "jobs",
    "schedule",
    "placement",
    "lifecycle",
    "spend"
  ], errors, ["schedule", "spend"]);
  if (deployment.jobs !== undefined && deployment.jobs !== null) {
    checkJobCount(deployment.jobs, "/deployment/jobs", errors);
  }
  const schedule = checkObject(deployment.schedule, "/deployment/schedule", ["duration", "phasing"], errors, ["duration"]);
  checkDuration(schedule.duration, "/deployment/schedule/duration", errors);
  if (schedule.phasing !== undefined && schedule.phasing !== null) {
    const phasing = object(schedule.phasing);
    if (!phasing) {
      errors.push(invalid("must be an object", "/deployment/schedule/phasing"));
    } else if (phasing.mode === "simultaneous") {
      checkObject(schedule.phasing, "/deployment/schedule/phasing", ["mode"], errors, ["mode"]);
    } else if (phasing.mode === "evenly_spaced") {
      const spaced = checkObject(schedule.phasing, "/deployment/schedule/phasing", ["mode", "jobsPerPhase"], errors, ["mode"]);
      if (spaced.jobsPerPhase !== undefined && spaced.jobsPerPhase !== null) {
        checkJobCount(spaced.jobsPerPhase, "/deployment/schedule/phasing/jobsPerPhase", errors);
      }
    } else {
      errors.push(invalid("phasing.mode must be simultaneous or evenly_spaced", "/deployment/schedule/phasing/mode"));
    }
  }
  if (deployment.placement !== undefined && deployment.placement !== null) {
    validatePlacement(deployment.placement, errors);
  }
  if (deployment.lifecycle !== undefined && deployment.lifecycle !== null) {
    validateLifecycle(deployment.lifecycle, errors);
  }
  validateSpend(deployment.spend, errors);
}

function validatePlacement(value: unknown, errors: PolicyValidationError[]): void {
  const raw = object(value) ?? {};
  const deferredPlacement: Record<string, string> = {
    spread: "placement spread is deferred from thin V5",
    groups: "counted placement groups are deferred from thin V5",
    distribution: "placement distribution is deferred from thin V5"
  };
  for (const [key, message] of Object.entries(deferredPlacement)) {
    if (key in raw) errors.push(unknownField(`/deployment/placement/${key}`, message));
  }
  const placement = checkObject(value, "/deployment/placement", [
    "minimums",
    "processorSelection",
    "spread",
    "groups",
    "distribution"
  ], errors);
  if (placement.minimums !== undefined && placement.minimums !== null) {
    const minimums = checkObject(placement.minimums, "/deployment/placement/minimums", [
      "memory",
      "storage",
      "cpuSingleCoreScore",
      "cpuMultiCoreScore"
    ], errors);
    const present = ["memory", "storage", "cpuSingleCoreScore", "cpuMultiCoreScore"]
      .filter((key) => minimums[key] !== undefined && minimums[key] !== null);
    if (present.length === 0) {
      errors.push(invalid("minimums must declare at least one constraint", "/deployment/placement/minimums"));
    }
    for (const key of ["memory", "storage"] as const) {
      if (minimums[key] !== undefined && minimums[key] !== null) {
        checkPattern(minimums[key], BYTE_SIZE, `/deployment/placement/minimums/${key}`, errors, "must be a byte size like 512MiB");
      }
    }
    for (const key of ["cpuSingleCoreScore", "cpuMultiCoreScore"] as const) {
      if (minimums[key] !== undefined && minimums[key] !== null) {
        const score = minimums[key];
        if (!Number.isSafeInteger(score) || (score as number) < 1) {
          errors.push(invalid("must be a positive integer score", `/deployment/placement/minimums/${key}`));
        }
      }
    }
  }
  if (placement.processorSelection !== undefined && placement.processorSelection !== null) {
    const selection = object(placement.processorSelection);
    if (!selection) {
      errors.push(invalid("must be an object", "/deployment/placement/processorSelection"));
    } else if (selection.mode === "exact") {
      const exact = checkObject(placement.processorSelection, "/deployment/placement/processorSelection", [
        "mode",
        "processorIds"
      ], errors, ["mode", "processorIds"]);
      if (!Array.isArray(exact.processorIds) || exact.processorIds.length < 1 || exact.processorIds.length > 64
        || exact.processorIds.some((id) => typeof id !== "string" || id.trim() === "")) {
        errors.push(invalid("processorIds must be 1..=64 non-empty strings", "/deployment/placement/processorSelection/processorIds"));
      }
    } else if (selection.mode === "manager" || selection.mode === "open_market" || selection.mode === "static") {
      errors.push(deferred("manager and open-market processor selection is not a retained V5 authoring arm", "/deployment/placement/processorSelection/mode"));
    } else {
      errors.push(invalid("processorSelection.mode must be exact", "/deployment/placement/processorSelection/mode"));
    }
  }
}

function validateLifecycle(value: unknown, errors: PolicyValidationError[]): void {
  const lifecycle = checkObject(value, "/deployment/lifecycle", ["renewal", "update"], errors);
  if (lifecycle.renewal !== undefined && lifecycle.renewal !== null) {
    const renewal = checkObject(lifecycle.renewal, "/deployment/lifecycle/renewal", ["leadTime"], errors);
    if (renewal.leadTime !== undefined && renewal.leadTime !== null) {
      const lead = object(renewal.leadTime);
      if (!lead) {
        errors.push(invalid("must be an object", "/deployment/lifecycle/renewal/leadTime"));
      } else if (lead.mode === "automatic") {
        checkObject(renewal.leadTime, "/deployment/lifecycle/renewal/leadTime", ["mode"], errors, ["mode"]);
      } else if (lead.mode === "fixed") {
        const fixed = checkObject(renewal.leadTime, "/deployment/lifecycle/renewal/leadTime", ["mode", "duration"], errors, [
          "mode",
          "duration"
        ]);
        checkDuration(fixed.duration, "/deployment/lifecycle/renewal/leadTime/duration", errors);
      } else {
        errors.push(invalid("leadTime.mode must be automatic or fixed", "/deployment/lifecycle/renewal/leadTime/mode"));
      }
    }
  }
  if (lifecycle.update !== undefined && lifecycle.update !== null) {
    const update = checkObject(lifecycle.update, "/deployment/lifecycle/update", ["timing", "existingJobs"], errors);
    if (update.timing !== undefined && update.timing !== null
      && update.timing !== "immediate" && update.timing !== "next_renewal") {
      errors.push(invalid("update.timing must be immediate or next_renewal", "/deployment/lifecycle/update/timing"));
    }
    if (update.existingJobs !== undefined && update.existingJobs !== null) {
      const existing = checkObject(update.existingJobs, "/deployment/lifecycle/update/existingJobs", ["mode"], errors, ["mode"]);
      if (existing.mode !== "run_until_scheduled_end" && existing.mode !== "stop_when_successor_ready") {
        errors.push(invalid(
          "existingJobs.mode must be run_until_scheduled_end or stop_when_successor_ready",
          "/deployment/lifecycle/update/existingJobs/mode"
        ));
      }
    }
  }
}

function validateSpend(value: unknown, errors: PolicyValidationError[]): void {
  const spend = checkObject(value, "/deployment/spend", ["unit", "perJob", "rate"], errors, ["unit", "perJob"]);
  if (spend.unit === "acu" || spend.unit === "acu_planck") {
    errors.push(deferred("self-custody ACU spend is deferred from thin V5", "/deployment/spend/unit"));
  } else if (spend.unit !== "service_credit_micros") {
    errors.push(invalid("spend.unit must be service_credit_micros", "/deployment/spend/unit"));
  }
  checkMicros(spend.perJob, "/deployment/spend/perJob", errors);
  if (spend.rate !== undefined && spend.rate !== null) {
    const rate = checkObject(spend.rate, "/deployment/spend/rate", ["amount", "window"], errors, ["amount"]);
    checkMicros(rate.amount, "/deployment/spend/rate/amount", errors);
    if (rate.window !== undefined && rate.window !== null) checkDuration(rate.window, "/deployment/spend/rate/window", errors);
  }
}

function validateAccess(value: unknown, errors: PolicyValidationError[]): void {
  const access = checkObject(value, "/access", ["ssh"], errors);
  if (access.ssh === undefined || access.ssh === null) return;
  const ssh = checkObject(access.ssh, "/access/ssh", ["provider"], errors, ["provider"]);
  const provider = object(ssh.provider);
  if (!provider) {
    errors.push(invalid("must be an object", "/access/ssh/provider"));
    return;
  }
  if (provider.kind === "liskov_managed") {
    checkObject(ssh.provider, "/access/ssh/provider", ["kind"], errors, ["kind"]);
    return;
  }
  errors.push(deferred(
    "SSH providers other than liskov_managed are deferred from thin V5",
    "/access/ssh/provider/kind"
  ));
}

function validateConfiguration(value: unknown, errors: PolicyValidationError[]): void {
  const configuration = checkObject(value, "/configuration", ["variables", "secrets"], errors);
  if (configuration.variables !== undefined && configuration.variables !== null) {
    if (!Array.isArray(configuration.variables)) {
      errors.push(invalid("must be an array", "/configuration/variables"));
    } else {
      configuration.variables.forEach((entry, index) => {
        const at = `/configuration/variables/${index}`;
        const variable = object(entry);
        if (!variable) {
          errors.push(invalid("must be an object", at));
          return;
        }
        if (variable.source === "literal") {
          const literal = checkObject(entry, at, ["source", "name", "value"], errors, ["source", "name", "value"]);
          checkPattern(literal.name, ENV_NAME, `${at}/name`, errors, "must be an environment name");
          if (typeof literal.value !== "string") errors.push(invalid("must be a string", `${at}/value`));
        } else if (variable.source === "managed") {
          const managed = checkObject(entry, at, ["source", "name", "required", "default"], errors, ["source", "name"]);
          checkPattern(managed.name, ENV_NAME, `${at}/name`, errors, "must be an environment name");
          if (managed.required !== undefined && managed.required !== null && typeof managed.required !== "boolean") {
            errors.push(invalid("must be a boolean", `${at}/required`));
          }
          if (managed.default !== undefined && managed.default !== null && typeof managed.default !== "string") {
            errors.push(invalid("must be a string", `${at}/default`));
          }
        } else {
          errors.push(invalid("variable source must be literal or managed", `${at}/source`));
        }
      });
    }
  }
  if (configuration.secrets !== undefined && configuration.secrets !== null) {
    if (!Array.isArray(configuration.secrets)) {
      errors.push(invalid("must be an array", "/configuration/secrets"));
    } else {
      configuration.secrets.forEach((entry, index) => {
        const at = `/configuration/secrets/${index}`;
        const secret = checkObject(entry, at, ["secretId", "required", "destination"], errors, ["secretId", "destination"]);
        checkPattern(secret.secretId, SECRET_ID, `${at}/secretId`, errors, "must be a secret id");
        if (secret.required !== undefined && secret.required !== null && typeof secret.required !== "boolean") {
          errors.push(invalid("must be a boolean", `${at}/required`));
        }
        const destination = object(secret.destination);
        if (!destination) {
          errors.push(invalid("must be an object", `${at}/destination`));
        } else if (destination.kind === "environment") {
          const env = checkObject(secret.destination, `${at}/destination`, ["kind", "name"], errors, ["kind", "name"]);
          checkPattern(env.name, ENV_NAME, `${at}/destination/name`, errors, "must be an environment name");
        } else if (destination.kind === "file") {
          const file = checkObject(secret.destination, `${at}/destination`, ["kind", "path"], errors, ["kind", "path"]);
          checkPattern(file.path, ABSOLUTE_PATH, `${at}/destination/path`, errors, "must be an absolute in-job path");
        } else {
          errors.push(invalid("destination.kind must be environment or file", `${at}/destination/kind`));
        }
      });
    }
  }
}

function validateObservability(value: unknown, errors: PolicyValidationError[]): void {
  const observability = checkObject(value, "/observability", ["logs"], errors);
  if (observability.logs === undefined || observability.logs === null) return;
  const logs = checkObject(observability.logs, "/observability/logs", ["enabled"], errors, ["enabled"]);
  if (typeof logs.enabled !== "boolean") {
    errors.push(invalid("must be a boolean", "/observability/logs/enabled"));
  }
}

function validateState(value: unknown, errors: PolicyValidationError[]): void {
  const state = object(value);
  if (!state) {
    errors.push(invalid("must be an object", "/state"));
    return;
  }
  if (state.mode === "off") {
    checkObject(value, "/state", ["mode"], errors, ["mode"]);
    return;
  }
  checkObject(value, "/state", ["mode"], errors, ["mode"]);
  errors.push(deferred("durable state beyond mode off is deferred from thin V5", "/state/mode"));
}

