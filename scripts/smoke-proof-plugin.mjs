import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proofCliRoot = path.resolve(process.env.PROOF_CLI_ROOT ?? path.join(repoRoot, "..", "proof-cli"));
const proofDevBin = path.join(proofCliRoot, "bin", "dev.js");
const home = await mkdtemp(path.join(tmpdir(), "proof-cli-slipway-smoke-"));

try {
  const env = {
    ...process.env,
    HOME: home,
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    NODE_ENV: "test"
  };

  run(process.execPath, [proofDevBin, "plugins", "link", repoRoot], { cwd: proofCliRoot, env });

  const plugins = run(process.execPath, [proofDevBin, "plugins"], { cwd: proofCliRoot, env });
  assertIncludes(plugins.stdout, "@proof-computer/proof-cli-slipway");

  const help = run(process.execPath, [proofDevBin, "slipway", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(help.stdout, "Slipway application deployment commands");

  const loginHelp = run(process.execPath, [proofDevBin, "slipway", "login", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(loginHelp.stdout, "Start Slipway CLI login");
  assertIncludes(loginHelp.stdout, "--no-browser");

  const applicationHelp = run(process.execPath, [proofDevBin, "slipway", "application", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationHelp.stdout, "Read Slipway Application state");

  const applicationListHelp = run(process.execPath, [proofDevBin, "slipway", "application", "list", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationListHelp.stdout, "List readable Slipway Applications");

  const applicationBackfillIdentitiesHelp = run(process.execPath, [proofDevBin, "slipway", "application", "backfill-identities", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationBackfillIdentitiesHelp.stdout, "Backfill Slipway Application identity fields");
  assertIncludes(applicationBackfillIdentitiesHelp.stdout, "--yes");

  const applicationDeleteHelp = run(process.execPath, [proofDevBin, "slipway", "application", "delete", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationDeleteHelp.stdout, "Tombstone a Slipway Application");
  assertIncludes(applicationDeleteHelp.stdout, "--force");
  assertIncludes(applicationDeleteHelp.stdout, "--yes");

  const applicationImportHelp = run(process.execPath, [proofDevBin, "slipway", "application", "import", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationImportHelp.stdout, "Import a Slipway Application policy");
  assertIncludes(applicationImportHelp.stdout, "--github");
  assertIncludes(applicationImportHelp.stdout, "--server-fetch");

  const applicationStatusHelp = run(process.execPath, [proofDevBin, "slipway", "application", "status", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationStatusHelp.stdout, "Read Slipway Application status");
  assertIncludes(applicationStatusHelp.stdout, "APPLICATION_ID");

  const applicationPlansHelp = run(process.execPath, [proofDevBin, "slipway", "application", "plans", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationPlansHelp.stdout, "Read Slipway Application execution plans");
  assertIncludes(applicationPlansHelp.stdout, "APPLICATION_ID");

  const applicationLockboxHelp = run(process.execPath, [proofDevBin, "slipway", "application", "lockbox", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLockboxHelp.stdout, "Read Slipway Application Lockbox state");

  const applicationLockboxGrantStatusHelp = run(process.execPath, [proofDevBin, "slipway", "application", "lockbox", "grant-status", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLockboxGrantStatusHelp.stdout, "Read Slipway Application Lockbox grant status");
  assertIncludes(applicationLockboxGrantStatusHelp.stdout, "APPLICATION_ID");

  const whoamiHelp = run(process.execPath, [proofDevBin, "slipway", "whoami", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(whoamiHelp.stdout, "Read the current Slipway CLI session");
  assertIncludes(whoamiHelp.stdout, "--json");

  const logoutHelp = run(process.execPath, [proofDevBin, "slipway", "logout", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(logoutHelp.stdout, "Remove the local Slipway CLI session");

  console.log("Root proof Slipway plugin smoke passed.");
} finally {
  await rm(home, { recursive: true, force: true });
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    shell: false
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      `exit: ${result.status}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${JSON.stringify(expected)}.\nOutput:\n${value}`);
  }
}
