import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

const requiredArtifacts = [
  "dist/commands/slipway.js",
  "dist/commands/slipway/application.js",
  "dist/commands/slipway/application/blackbox.js",
  "dist/commands/slipway/application/blackbox/configure.js",
  "dist/commands/slipway/application/deployment.js",
  "dist/commands/slipway/application/deployment/import.js",
  "dist/commands/slipway/application/import.js",
  "dist/commands/slipway/application/lockbox.js",
  "dist/commands/slipway/application/lockbox/dispatch.js",
  "dist/commands/slipway/application/lockbox/grant.js",
  "dist/commands/slipway/application/lockbox/grant/ensure.js",
  "dist/commands/slipway/application/lockbox/grant/status.js",
  "dist/commands/slipway/application/lockbox/grant/verify.js",
  "dist/commands/slipway/application/lockbox/grant-status.js",
  "dist/commands/slipway/application/lockbox/setup-pr.js",
  "dist/commands/slipway/application/plans.js",
  "dist/commands/slipway/application/status.js",
  "dist/commands/slipway/custody.js",
  "dist/commands/slipway/custody/account.js",
  "dist/commands/slipway/custody/account/ensure.js",
  "dist/commands/slipway/custody/child.js",
  "dist/commands/slipway/custody/child/recover.js",
  "dist/commands/slipway/custody/environment.js",
  "dist/commands/slipway/custody/environment/upload.js",
  "dist/commands/slipway/custody/execution.js",
  "dist/commands/slipway/custody/execution/diagnose.js",
  "dist/commands/slipway/custody/execution/list.js",
  "dist/commands/slipway/custody/execution/observe.js",
  "dist/commands/slipway/custody/execution/recover.js",
  "dist/commands/slipway/custody/execution/submit.js",
  "dist/commands/slipway/custody/machine.js",
  "dist/commands/slipway/custody/machine/catalog.js",
  "dist/commands/slipway/custody/preflight.js",
  "dist/commands/slipway/login.js",
  "dist/commands/slipway/logout.js",
  "dist/commands/slipway/whoami.js",
  "dist/index.js",
  "dist/session.js",
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
  "@proof-computer/proof-cli-switchboard"
];

const errors = [];

if (packageJson.name !== "@proof-computer/proof-cli-slipway") {
  errors.push("package.json name must be @proof-computer/proof-cli-slipway");
}

if (packageJson.private !== true) {
  errors.push("package.json private must be true until Slipway is intentionally exposed");
}

if (packageJson.bin) {
  errors.push("Slipway proof plugin must not publish a standalone bin");
}

for (const artifact of requiredArtifacts) {
  try {
    await access(path.join(repoRoot, artifact));
  } catch {
    errors.push(`Missing package artifact: ${artifact}`);
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

if (!packageJson.oclif?.topics?.slipway) {
  errors.push("package.json oclif.topics must declare slipway");
}

const dependencyBlocks = [
  packageJson.dependencies ?? {},
  packageJson.devDependencies ?? {},
  packageJson.optionalDependencies ?? {},
  packageJson.peerDependencies ?? {}
];
for (const forbidden of forbiddenDependencies) {
  if (dependencyBlocks.some((block) => Object.hasOwn(block, forbidden))) {
    errors.push(`Slipway plugin must not depend on sibling product package ${forbidden}`);
  }
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log("Package artifacts verified.");
