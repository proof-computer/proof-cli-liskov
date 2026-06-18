import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

const requiredArtifacts = [
  "dist/commands/liskov.js",
  "dist/commands/liskov/application.js",
  "dist/commands/liskov/application/blackbox.js",
  "dist/commands/liskov/application/blackbox/configure.js",
  "dist/commands/liskov/application/deployment.js",
  "dist/commands/liskov/application/deployment/import.js",
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
  "dist/commands/liskov/custody.js",
  "dist/commands/liskov/custody/account.js",
  "dist/commands/liskov/custody/account/ensure.js",
  "dist/commands/liskov/custody/child.js",
  "dist/commands/liskov/custody/child/recover.js",
  "dist/commands/liskov/custody/environment.js",
  "dist/commands/liskov/custody/environment/upload.js",
  "dist/commands/liskov/custody/execution.js",
  "dist/commands/liskov/custody/execution/diagnose.js",
  "dist/commands/liskov/custody/execution/list.js",
  "dist/commands/liskov/custody/execution/observe.js",
  "dist/commands/liskov/custody/execution/recover.js",
  "dist/commands/liskov/custody/execution/submit.js",
  "dist/commands/liskov/custody/machine.js",
  "dist/commands/liskov/custody/machine/catalog.js",
  "dist/commands/liskov/custody/preflight.js",
  "dist/commands/liskov/login.js",
  "dist/commands/liskov/logout.js",
  "dist/commands/liskov/whoami.js",
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
  "@proof-computer/proof-cli-baran"
];

const errors = [];

if (packageJson.name !== "@proof-computer/proof-cli-liskov") {
  errors.push("package.json name must be @proof-computer/proof-cli-liskov");
}

if (packageJson.private !== true) {
  errors.push("package.json private must be true until Liskov is intentionally exposed");
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

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log("Package artifacts verified.");
