import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const oclifManifest = JSON.parse(await readFile(path.join(repoRoot, "oclif.manifest.json"), "utf8"));

const requiredArtifacts = [
  "dist/commands/liskov.js",
  "dist/commands/liskov/application.js",
  "dist/commands/liskov/application/logs.js",
  "dist/commands/liskov/application/execution.js",
  "dist/commands/liskov/application/execution/show.js",
  "dist/commands/liskov/application/deployment.js",
  "dist/commands/liskov/application/deployment/import.js",
  "dist/commands/liskov/application/delete.js",
  "dist/commands/liskov/application/import.js",
  "dist/commands/liskov/application/lockbox.js",
  "dist/commands/liskov/application/lockbox/dispatch.js",
  "dist/commands/liskov/application/lockbox/grant.js",
  "dist/commands/liskov/application/lockbox/grant/ensure.js",
  "dist/commands/liskov/application/lockbox/grant/status.js",
  "dist/commands/liskov/application/lockbox/grant/verify.js",
  "dist/commands/liskov/application/lockbox/grant-status.js",
  "dist/commands/liskov/application/lockbox/setup-pr.js",
  "dist/commands/liskov/application/plans.js",
  "dist/commands/liskov/application/status.js",
  "dist/commands/liskov/admin/executor-operation.js",
  "dist/commands/liskov/admin/executor-operation/reconcile.js",
  "dist/commands/liskov/custody.js",
  "dist/commands/liskov/custody/account.js",
  "dist/commands/liskov/custody/account/ensure.js",
  "dist/commands/liskov/custody/environment.js",
  "dist/commands/liskov/custody/environment/upload.js",
  "dist/commands/liskov/custody/execution.js",
  "dist/commands/liskov/custody/execution/diagnose.js",
  "dist/commands/liskov/custody/execution/list.js",
  "dist/commands/liskov/custody/execution/observe.js",
  "dist/commands/liskov/custody/execution/recover.js",
  "dist/commands/liskov/custody/execution/retry.js",
  "dist/commands/liskov/custody/execution/run-one.js",
  "dist/commands/liskov/custody/execution/submit.js",
  "dist/commands/liskov/custody/machine.js",
  "dist/commands/liskov/custody/machine/catalog.js",
  "dist/commands/liskov/custody/pair.js",
  "dist/commands/liskov/custody/preflight.js",
  "dist/commands/liskov/login.js",
  "dist/commands/liskov/logout.js",
  "dist/commands/liskov/whoami.js",
  "dist/index.js",
  "dist/organization-context.js",
  "dist/session.js",
  "dist/policy-client-bundle/policy-client-bundle.json",
  "dist/policy-client-bundle/policy-client-contract.wasm.gz",
  "dist/policy-client-bundle/policy-client.cjs",
  "oclif.manifest.json",
  "README.md"
];
const requiredFilesEntries = [
  "dist",
  "oclif.manifest.json",
  "README.md"
];
const forbiddenDependencies = [
  "slipway",
  "@proof-computer/proof-cli-blackbox",
  "@proof-computer/proof-cli-lockbox",
  "@proof-computer/proof-cli-baran"
];
const forbiddenArtifacts = [
  "dist/commands/liskov/application/blackbox.js",
  "dist/commands/liskov/application/blackbox/configure.js"
];

const errors = [];

if (packageJson.name !== "@proof-computer/proof-cli-liskov") {
  errors.push("package.json name must be @proof-computer/proof-cli-liskov");
}

if (packageJson.bin) {
  errors.push("Liskov proof plugin must not publish a standalone bin");
}

for (const artifact of requiredArtifacts) {
  try {
    await access(path.join(repoRoot, artifact));
  } catch {
    errors.push(`Missing package artifact: ${artifact}`);
  }
}

for (const artifact of forbiddenArtifacts) {
  try {
    await access(path.join(repoRoot, artifact));
    errors.push(`Retired package artifact is still present: ${artifact}`);
  } catch {
    // Absence is the required state.
  }
}

for (const entry of requiredFilesEntries) {
  if (!packageJson.files?.includes(entry)) {
    errors.push(`package.json files must include ${entry}`);
  }
}

if (packageJson.oclif?.commands !== "./dist/commands") {
  errors.push("package.json oclif.commands must point to ./dist/commands");
}

if (packageJson.oclif?.topicSeparator !== " ") {
  errors.push("package.json oclif.topicSeparator must be a single space");
}

if (!packageJson.oclif?.topics?.liskov) {
  errors.push("package.json oclif.topics must declare liskov");
}

const dependencyBlocks = [
  packageJson.dependencies ?? {},
  packageJson.devDependencies ?? {},
  packageJson.optionalDependencies ?? {},
  packageJson.peerDependencies ?? {}
];
for (const forbidden of forbiddenDependencies) {
  if (dependencyBlocks.some((block) => Object.hasOwn(block, forbidden))) {
    errors.push(`Liskov plugin must not depend on sibling product package ${forbidden}`);
  }
}

const locallyUnscopedCommands = new Set([
  "liskov:login",
  "liskov:logout",
  "liskov:organization:list",
  "liskov:application:manifest:validate",
  "liskov:application:runtime-image:workflow"
]);
const scopedLeafCommands = Object.values(oclifManifest.commands).filter((command) => {
  if (!command.strict || locallyUnscopedCommands.has(command.id)) return false;
  return command.id === "liskov:whoami" ||
    command.id === "liskov:ssh" ||
    command.id.startsWith("liskov:application:") ||
    command.id.startsWith("liskov:custody:") ||
    command.id.startsWith("liskov:organization:billing") ||
    command.id === "liskov:organization:service-credits" ||
    command.id === "liskov:organization:use" ||
    command.id.startsWith("liskov:runtime-ssh:");
});
for (const command of scopedLeafCommands) {
  const organizationFlag = command.flags?.organization;
  if (organizationFlag?.env !== "LISKOV_ORGANIZATION" || organizationFlag.char !== undefined) {
    errors.push(`${command.id} must expose --organization with LISKOV_ORGANIZATION and no short alias`);
  }
}

const unscopedCommands = Object.values(oclifManifest.commands).filter((command) =>
  locallyUnscopedCommands.has(command.id) ||
  command.id === "liskov:access:proxy" ||
  command.id.startsWith("liskov:admin:")
);
for (const command of unscopedCommands) {
  if (command.flags?.organization !== undefined) {
    errors.push(`${command.id} must not expose --organization`);
  }
}


const publication = oclifManifest.commands["liskov:application:policy:publish"];
if (!publication?.flags?.["dry-run"] || !publication.flags.paused || !publication.flags.reason || publication.flags.yes.required) {
  errors.push("Registered publication must package preview and paused-setup flags without requiring --yes for preview");
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log("Package artifacts verified.");
