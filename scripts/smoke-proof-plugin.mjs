import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proofCliRoot = path.resolve(process.env.PROOF_CLI_ROOT ?? path.join(repoRoot, "..", "proof-cli"));
const proofDevBin = path.join(proofCliRoot, "bin", "dev.js");
const home = await mkdtemp(path.join(tmpdir(), "proof-cli-liskov-smoke-"));

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
  assertIncludes(plugins.stdout, "@proof-computer/proof-cli-liskov");

  const help = run(process.execPath, [proofDevBin, "liskov", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(help.stdout, "Liskov application deployment commands");
  assertIncludes(help.stdout, "liskov custody");

  const loginHelp = run(process.execPath, [proofDevBin, "liskov", "login", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(loginHelp.stdout, "Start Liskov CLI login");
  assertIncludes(loginHelp.stdout, "--no-browser");

  const applicationHelp = run(process.execPath, [proofDevBin, "liskov", "application", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationHelp.stdout, "Read Liskov Application state");
  assertIncludes(applicationHelp.stdout, "liskov application deployment");
  assertIncludes(applicationHelp.stdout, "liskov application blackbox");

  const applicationListHelp = run(process.execPath, [proofDevBin, "liskov", "application", "list", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationListHelp.stdout, "List readable Liskov Applications");
  assertIncludes(applicationListHelp.stdout, "--deleted");

  const applicationBackfillIdentitiesHelp = run(process.execPath, [proofDevBin, "liskov", "application", "backfill-identities", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationBackfillIdentitiesHelp.stdout, "Backfill Liskov Application identity fields");
  assertIncludes(applicationBackfillIdentitiesHelp.stdout, "--yes");

  const applicationDeleteHelp = run(process.execPath, [proofDevBin, "liskov", "application", "delete", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationDeleteHelp.stdout, "Tombstone a Liskov Application");
  assertIncludes(applicationDeleteHelp.stdout, "--acknowledge-live-resources");
  assertIncludes(applicationDeleteHelp.stdout, "--force");
  assertIncludes(applicationDeleteHelp.stdout, "--yes");

  const applicationPauseHelp = run(process.execPath, [proofDevBin, "liskov", "application", "pause", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationPauseHelp.stdout, "Pause new Liskov work");
  assertIncludes(applicationPauseHelp.stdout, "--reason");
  assertIncludes(applicationPauseHelp.stdout, "--yes");

  const applicationPublishHelp = run(process.execPath, [proofDevBin, "liskov", "application", "publish", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationPublishHelp.stdout, "--paused");
  assertIncludes(applicationPublishHelp.stdout, "--reason");
  assertIncludes(applicationPublishHelp.stdout, "--yes");

  const applicationResumeHelp = run(process.execPath, [proofDevBin, "liskov", "application", "resume", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationResumeHelp.stdout, "Resume new Liskov work");
  assertIncludes(applicationResumeHelp.stdout, "--reason");
  assertIncludes(applicationResumeHelp.stdout, "--yes");

  const applicationImportHelp = run(process.execPath, [proofDevBin, "liskov", "application", "import", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationImportHelp.stdout, "Import a Liskov Application policy");
  assertIncludes(applicationImportHelp.stdout, "--github");
  assertIncludes(applicationImportHelp.stdout, "--server-fetch");

  const applicationStatusHelp = run(process.execPath, [proofDevBin, "liskov", "application", "status", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationStatusHelp.stdout, "Read Liskov Application status");
  assertIncludes(applicationStatusHelp.stdout, "APPLICATION_ID");

  const applicationPlansHelp = run(process.execPath, [proofDevBin, "liskov", "application", "plans", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationPlansHelp.stdout, "Read Liskov Application execution plans");
  assertIncludes(applicationPlansHelp.stdout, "APPLICATION_ID");

  const applicationLockboxHelp = run(process.execPath, [proofDevBin, "liskov", "application", "lockbox", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLockboxHelp.stdout, "Read Liskov Application Lockbox state");
  assertIncludes(applicationLockboxHelp.stdout, "grant-status");

  const applicationLockboxGrantStatusHelp = run(process.execPath, [proofDevBin, "liskov", "application", "lockbox", "grant-status", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLockboxGrantStatusHelp.stdout, "Read Liskov Application Lockbox grant status");
  assertIncludes(applicationLockboxGrantStatusHelp.stdout, "APPLICATION_ID");

  const applicationLockboxGrantStatusNativeHelp = run(process.execPath, [proofDevBin, "liskov", "application", "lockbox", "grant", "status", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLockboxGrantStatusNativeHelp.stdout, "Read Liskov Application Lockbox grant status");
  assertIncludes(applicationLockboxGrantStatusNativeHelp.stdout, "APP_REF");

  const applicationDeploymentImportHelp = run(process.execPath, [proofDevBin, "liskov", "application", "deployment", "import", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationDeploymentImportHelp.stdout, "Import an existing Acurast deployment");
  assertIncludes(applicationDeploymentImportHelp.stdout, "--origin");
  assertIncludes(applicationDeploymentImportHelp.stdout, "--yes");

  const custodyHelp = run(process.execPath, [proofDevBin, "liskov", "custody", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(custodyHelp.stdout, "Operate Liskov live custody");
  assertIncludes(custodyHelp.stdout, "liskov custody execution");

  const custodySubmitHelp = run(process.execPath, [proofDevBin, "liskov", "custody", "execution", "submit", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(custodySubmitHelp.stdout, "Submit a live custody execution");
  assertIncludes(custodySubmitHelp.stdout, "--yes-spend");

  const custodyRunOneHelp = run(process.execPath, [proofDevBin, "liskov", "custody", "execution", "run-one", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(custodyRunOneHelp.stdout, "Run exactly one guarded server-owned live custody transition");
  assertIncludes(custodyRunOneHelp.stdout, "Opaque idempotencyKey copied unchanged");

  const custodyMachineCatalogHelp = run(process.execPath, [proofDevBin, "liskov", "custody", "machine", "catalog", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(custodyMachineCatalogHelp.stdout, "Read Acurast machine-class catalog");

  const reconcileHelp = run(process.execPath, [proofDevBin, "liskov", "admin", "executor-operation", "reconcile", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(reconcileHelp.stdout, "Reconcile a provably unsubmitted replacement operation");
  assertIncludes(reconcileHelp.stdout, "--expect-application");
  assertIncludes(reconcileHelp.stdout, "--expect-deployment");
  assertIncludes(reconcileHelp.stdout, "--expect-job");
  assertIncludes(reconcileHelp.stdout, "--yes");

  const deploySpendResolveHelp = run(process.execPath, [proofDevBin, "liskov", "admin", "deploy-spend", "resolve", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(deploySpendResolveHelp.stdout, "Resolve a deploy-spend review hold");
  assertIncludes(deploySpendResolveHelp.stdout, "--expect-billing-transaction");
  assertIncludes(deploySpendResolveHelp.stdout, "--final-usd-micros");
  assertIncludes(deploySpendResolveHelp.stdout, "--evidence-sha256");
  assertIncludes(deploySpendResolveHelp.stdout, "--yes");

  const whoamiHelp = run(process.execPath, [proofDevBin, "liskov", "whoami", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(whoamiHelp.stdout, "Read the current Liskov CLI session");
  assertIncludes(whoamiHelp.stdout, "--json");

  const logoutHelp = run(process.execPath, [proofDevBin, "liskov", "logout", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(logoutHelp.stdout, "Remove the local Liskov CLI session");

  console.log("Root proof Liskov plugin smoke passed.");
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
      `signal: ${result.signal}`,
      result.error ? `spawn error: ${result.error.message}` : "",
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
