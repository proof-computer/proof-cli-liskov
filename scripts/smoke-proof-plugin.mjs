import { createServer } from "node:http";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
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

  const sshHelp = run(process.execPath, [proofDevBin, "liskov", "ssh", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(sshHelp.stdout, "--key");
  assertIncludes(sshHelp.stdout, "--identity");

  const help = run(process.execPath, [proofDevBin, "liskov", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(help.stdout, "Liskov application deployment commands");
  assertIncludes(help.stdout.replace(/\s+/g, " "), "Live custody commands are operator-only and hidden");
  if (/^\s+liskov custody\b/m.test(help.stdout)) {
    throw new Error("Expected liskov --help not to list the operator-only custody topic");
  }

  const loginHelp = run(process.execPath, [proofDevBin, "liskov", "login", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(loginHelp.stdout, "Start Liskov CLI login");
  assertIncludes(loginHelp.stdout, "--no-browser");
  assertExcludes(loginHelp.stdout, "--organization");

  const applicationHelp = run(process.execPath, [proofDevBin, "liskov", "application", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationHelp.stdout, "Read Liskov Application state");
  assertIncludes(applicationHelp.stdout, "liskov application deployment");
  assertIncludes(applicationHelp.stdout, "liskov application logs");
  assertIncludes(applicationHelp.stdout, "liskov application vars");

  assertExcludes(applicationHelp.stdout, "placement-plan");
  const placementPlanHelp = run(process.execPath, [proofDevBin, "liskov", "application", "placement-plan", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(placementPlanHelp.stdout, "OCCURRENCE_AUTHORITY_DIGEST");
  assertIncludes(placementPlanHelp.stdout, "--organization");

  // Exercise the built, linked plugin against HTTP, including exact owner
  // seed/follower/null envelopes and malformed/unavailable refusals.
  const planVectors = JSON.parse(await readFile(path.join(repoRoot, "test/fixtures/application-placement-plan.json"), "utf8"));
  let servedPlan;
  let servedStatus = 200;
  const planToken = "placement-plan-smoke-token-never-print";
  const planRequests = [];
  const planServer = createServer((request, response) => {
    planRequests.push({ url: request.url, auth: request.headers.authorization, org: request.headers["x-liskov-organization"] });
    response.writeHead(servedStatus, { "content-type": "application/json" });
    response.end(JSON.stringify(servedPlan));
  });
  await new Promise((resolve, reject) => {
    planServer.once("error", reject);
    planServer.listen(0, "127.0.0.1", resolve);
  });
  try {
    const serviceUrl = `http://127.0.0.1:${planServer.address().port}`;
    const sessionFile = path.join(home, "placement-session.json");
    await writeFile(sessionFile, JSON.stringify({ version: 1, slipwayUrl: serviceUrl, sessionToken: planToken, savedAtMs: 1 }), { mode: 0o600 });
    const planEnv = { ...env, LISKOV_URL: serviceUrl, LISKOV_SESSION_TOKEN: planToken, LISKOV_ADMIN_SERVICE_TOKEN: "" };
    const planArgs = [proofDevBin, "liskov", "application", "placement-plan", "app /?", "sha256:a/b", "--config", sessionFile, "--liskov-url", serviceUrl, "--organization", "org_smoke", "--no-analytics"];
    for (const body of Object.values(planVectors)) {
      servedPlan = body;
      const result = await runAsync(process.execPath, [...planArgs, "--json"], { cwd: proofCliRoot, env: planEnv });
      if (result.status !== 0) throw new Error(`placement plan command failed: ${result.stderr}`);
      if (JSON.stringify(JSON.parse(result.stdout)) !== JSON.stringify(body)) throw new Error("placement plan changed owner JSON");
      assertExcludes(result.stdout + result.stderr, planToken);
    }
    servedPlan = planVectors.follower;
    const rendered = await runAsync(process.execPath, planArgs, { cwd: proofCliRoot, env: planEnv });
    if (rendered.status !== 0) throw new Error("placement plan human command failed");
    assertIncludes(rendered.stdout, "Initial feasibility snapshot (immutable)");
    for (const [body, status] of [[{}, 200], [{ ...planVectors.seed, schema: "unknown" }, 200], [{ ok: false }, 404], [{ ok: false }, 503]]) {
      servedPlan = body; servedStatus = status;
      const result = await runAsync(process.execPath, [...planArgs, "--json"], { cwd: proofCliRoot, env: planEnv });
      if (result.status === 0) throw new Error("placement plan accepted an invalid or unavailable response");
      assertExcludes(result.stdout + result.stderr, planToken);
    }
    if (!planRequests.length || planRequests.some((request) => request.url !== "/api/applications/app%20%2F%3F/placement/plans/sha256%3Aa%2Fb" || request.auth !== `Liskov-Organization ${planToken}` || request.org !== "org_smoke")) {
      throw new Error("placement plan path or organization/auth context changed");
    }
  } finally {
    planServer.closeAllConnections();
    await new Promise((resolve) => planServer.close(resolve));
  }

  assertExcludes(applicationHelp.stdout, "placement-refusals");
  const placementRefusalsHelp = run(process.execPath, [proofDevBin, "liskov", "application", "placement-refusals", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(placementRefusalsHelp.stdout, "APPLICATION_ID");
  for (const flag of ["--from-ms", "--to-ms", "--limit", "--cursor", "--json", "--organization"]) assertIncludes(placementRefusalsHelp.stdout, flag);
  assertIncludes(placementRefusalsHelp.stdout.replace(/\s+/g, " "), "Absent rows never mean placement succeeded");

  // The built, linked plugin against HTTP: every owner envelope, both output
  // paths, refusals, and flags the command must refuse before any request.
  const { badRequests: refusalBadRequests, ...refusalEnvelopes } = JSON.parse(await readFile(path.join(repoRoot, "test/fixtures/application-placement-refusals.json"), "utf8"));
  let servedRefusals;
  let servedRefusalsStatus = 200;
  const refusalsToken = "placement-refusals-smoke-token-never-print";
  const refusalsRequests = [];
  const refusalsServer = createServer((request, response) => {
    refusalsRequests.push({ url: request.url, auth: request.headers.authorization, org: request.headers["x-liskov-organization"] });
    response.writeHead(servedRefusalsStatus, { "content-type": "application/json" });
    response.end(JSON.stringify(servedRefusals));
  });
  await new Promise((resolve, reject) => {
    refusalsServer.once("error", reject);
    refusalsServer.listen(0, "127.0.0.1", resolve);
  });
  try {
    const serviceUrl = `http://127.0.0.1:${refusalsServer.address().port}`;
    const sessionFile = path.join(home, "placement-refusals-session.json");
    await writeFile(sessionFile, JSON.stringify({ version: 1, slipwayUrl: serviceUrl, sessionToken: refusalsToken, savedAtMs: 1 }), { mode: 0o600 });
    const refusalsEnv = { ...env, LISKOV_URL: serviceUrl, LISKOV_SESSION_TOKEN: refusalsToken, LISKOV_ADMIN_SERVICE_TOKEN: "" };
    const refusalsBase = [proofDevBin, "liskov", "application", "placement-refusals", "app /?", "--config", sessionFile, "--liskov-url", serviceUrl, "--organization", "org_smoke", "--no-analytics"];
    const refusalsArgs = [...refusalsBase, "--from-ms", "1757995200000", "--to-ms", "1758002400000", "--limit", "25", "--cursor", "a+b/c= d"];
    for (const body of Object.values(refusalEnvelopes)) {
      servedRefusals = body;
      const result = await runAsync(process.execPath, [...refusalsArgs, "--json"], { cwd: proofCliRoot, env: refusalsEnv });
      if (result.status !== 0) throw new Error(`placement refusals command failed: ${result.stderr}`);
      if (JSON.stringify(JSON.parse(result.stdout)) !== JSON.stringify(body)) throw new Error("placement refusals changed owner JSON");
      assertExcludes(result.stdout + result.stderr, refusalsToken);
    }
    servedRefusals = refusalEnvelopes.mixedHistory;
    const refusalsRendered = await runAsync(process.execPath, refusalsArgs, { cwd: proofCliRoot, env: refusalsEnv });
    if (refusalsRendered.status !== 0) throw new Error("placement refusals human command failed");
    assertIncludes(refusalsRendered.stdout, "Country: country_unavailable");
    assertIncludes(refusalsRendered.stdout, "Next action: retry_later");
    assertIncludes(refusalsRendered.stdout, "Spread: required_manager_spread_unsatisfied");
    assertIncludes(refusalsRendered.stdout, "Next action: review_required_manager_spread");
    servedRefusals = refusalEnvelopes.emptyHistory;
    const refusalsEmpty = await runAsync(process.execPath, refusalsArgs, { cwd: proofCliRoot, env: refusalsEnv });
    if (refusalsEmpty.status !== 0) throw new Error("placement refusals empty command failed");
    assertIncludes(refusalsEmpty.stdout, "There are no recorded refusals in this page.");
    assertIncludes(refusalsEmpty.stdout, "does not say placement succeeded");
    for (const [body, status] of [[{}, 200], [{ ...refusalEnvelopes.emptyHistory, schema: "unknown" }, 200], [{ ok: false, error: "unauthorized" }, 401], [refusalBadRequests.invalidCursor, 400], [{ ok: false, error: "internal_error" }, 500]]) {
      servedRefusals = body; servedRefusalsStatus = status;
      const result = await runAsync(process.execPath, [...refusalsArgs, "--json"], { cwd: proofCliRoot, env: refusalsEnv });
      if (result.status === 0) throw new Error("placement refusals accepted an invalid or unavailable response");
      assertExcludes(result.stdout + result.stderr, refusalsToken);
    }
    const expectedRefusalsUrl = "/api/applications/app%20%2F%3F/placement/refusals?fromMs=1757995200000&toMs=1758002400000&limit=25&cursor=a%2Bb%2Fc%3D+d";
    if (!refusalsRequests.length || refusalsRequests.some((request) => request.url !== expectedRefusalsUrl || request.auth !== `Liskov-Organization ${refusalsToken}` || request.org !== "org_smoke")) {
      throw new Error("placement refusals route, query or organization/auth context changed");
    }
    const requestsBeforeRefusedFlags = refusalsRequests.length;
    for (const flags of [
      ["--to-ms", "2", "--limit", "1"],
      ["--from-ms", "1", "--limit", "1"],
      ["--from-ms", "1", "--to-ms", "2"],
      ["--from-ms", "-1", "--to-ms", "2", "--limit", "1"],
      ["--from-ms", "2", "--to-ms", "2", "--limit", "1"],
      ["--from-ms", "1", "--to-ms", "2", "--limit", "101"]
    ]) {
      const result = await runAsync(process.execPath, [...refusalsBase, ...flags], { cwd: proofCliRoot, env: refusalsEnv });
      if (result.status === 0) throw new Error(`placement refusals accepted flags: ${flags.join(" ")}`);
    }
    if (refusalsRequests.length !== requestsBeforeRefusedFlags) throw new Error("placement refusals sent a request for flags it must refuse");
  } finally {
    refusalsServer.closeAllConnections();
    await new Promise((resolve) => refusalsServer.close(resolve));
  }

  const applicationVarsHelp = run(process.execPath, [proofDevBin, "liskov", "application", "vars", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationVarsHelp.stdout, "liskov application vars list");
  assertIncludes(applicationVarsHelp.stdout, "liskov application vars set");
  assertIncludes(applicationVarsHelp.stdout, "liskov application vars unset");

  const applicationVarsSetHelp = run(process.execPath, [proofDevBin, "liskov", "application", "vars", "set", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationVarsSetHelp.stdout, "APP_REF NAME VALUE");
  assertIncludes(applicationVarsSetHelp.stdout, "--yes");
  assertIncludes(applicationVarsSetHelp.stdout, "--organization <selector>");
  assertExcludes(applicationVarsSetHelp.stdout, "--unset");
  assertExcludes(applicationHelp.stdout, "blackbox");
  assertExcludes(applicationHelp.stdout, "lockbox");

  const applicationLogsHelp = run(process.execPath, [proofDevBin, "liskov", "application", "logs", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLogsHelp.stdout, "Read recent Liskov Application logs");
  assertIncludes(applicationLogsHelp.stdout, "--origin");
  assertIncludes(applicationLogsHelp.stdout, "runtime-ssh");
  assertIncludes(applicationLogsHelp.stdout, "runtime_ssh");
  assertIncludes(applicationLogsHelp.stdout, "--follow");
  assertIncludes(applicationLogsHelp.stdout, "--from-start");
  assertIncludes(applicationLogsHelp.stdout, "--ndjson");
  assertIncludes(applicationLogsHelp.stdout, "--event");
  assertIncludes(applicationLogsHelp.stdout, "--organization <selector>");
  assertIncludes(applicationLogsHelp.stdout, "LISKOV_ORGANIZATION");

  const applicationListHelp = run(process.execPath, [proofDevBin, "liskov", "application", "list", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationListHelp.stdout, "List readable Liskov Applications");
  assertIncludes(applicationListHelp.stdout, "--deleted");

  const organizationUseHelp = run(process.execPath, [proofDevBin, "liskov", "organization", "use", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(organizationUseHelp.stdout, "Select the active organization");
  assertIncludes(organizationUseHelp.stdout, "ORG_ID");
  assertIncludes(organizationUseHelp.stdout, "--json");
  assertIncludes(organizationUseHelp.stdout, "--organization <selector>");

  const organizationListHelp = run(process.execPath, [proofDevBin, "liskov", "organization", "list", "--help"], { cwd: proofCliRoot, env });
  assertExcludes(organizationListHelp.stdout, "--organization");

  const applicationBackfillIdentitiesHelp = run(process.execPath, [proofDevBin, "liskov", "application", "backfill-identities", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationBackfillIdentitiesHelp.stdout, "Backfill Liskov Application identity fields");
  assertIncludes(applicationBackfillIdentitiesHelp.stdout, "--yes");

  const applicationDeleteHelp = run(process.execPath, [proofDevBin, "liskov", "application", "delete", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationDeleteHelp.stdout, "Deprecated clean-only deletion bridge");
  assertIncludes(applicationDeleteHelp.stdout, "performs a read-only preview");
  assertIncludes(applicationDeleteHelp.stdout, "--acknowledge-live-resources");
  assertIncludes(applicationDeleteHelp.stdout, "--force");
  assertIncludes(applicationDeleteHelp.stdout, "--yes");

  const applicationRetireHelp = run(process.execPath, [proofDevBin, "liskov", "application", "retire", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationRetireHelp.stdout, "Read or start safe Liskov Application retirement");
  assertIncludes(applicationRetireHelp.stdout, "command is read only.");
  assertIncludes(applicationRetireHelp.stdout, "--reason");
  assertIncludes(applicationRetireHelp.stdout, "--yes");

  const applicationRetireCancelHelp = run(process.execPath, [proofDevBin, "liskov", "application", "retire", "cancel", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationRetireCancelHelp.stdout, "Cancel retirement and leave the Liskov Application paused");
  assertIncludes(applicationRetireCancelHelp.stdout, "--reason");
  assertIncludes(applicationRetireCancelHelp.stdout, "--yes");

  const applicationPauseHelp = run(process.execPath, [proofDevBin, "liskov", "application", "pause", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationPauseHelp.stdout, "Pause new Liskov work");
  assertIncludes(applicationPauseHelp.stdout, "--reason");
  assertIncludes(applicationPauseHelp.stdout, "--yes");

  const applicationPublishHelp = run(process.execPath, [proofDevBin, "liskov", "application", "publish", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationPublishHelp.stdout, "--paused");
  assertIncludes(applicationPublishHelp.stdout, "--reason");
  assertIncludes(applicationPublishHelp.stdout, "--yes");

  const registeredPolicyPublishHelp = run(process.execPath, [proofDevBin, "liskov", "application", "policy", "publish", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(registeredPolicyPublishHelp.stdout, "--artifact-digest");
  assertIncludes(registeredPolicyPublishHelp.stdout, "--expected-pointer-version");
  assertIncludes(registeredPolicyPublishHelp.stdout, "--workflow-identity");
  assertIncludes(registeredPolicyPublishHelp.stdout, "--yes");

  const sourceBindingSetHelp = run(process.execPath, [proofDevBin, "liskov", "application", "source-binding", "set", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(sourceBindingSetHelp.stdout, "--repository");
  assertIncludes(sourceBindingSetHelp.stdout, "--allowed-ref");
  assertIncludes(sourceBindingSetHelp.stdout, "--workflow-identity");
  assertIncludes(sourceBindingSetHelp.stdout, "--manifest-path");
  assertIncludes(sourceBindingSetHelp.stdout, "--expected-revision");
  assertIncludes(sourceBindingSetHelp.stdout, "--yes");

  const sourceBindingShowHelp = run(process.execPath, [proofDevBin, "liskov", "application", "source-binding", "show", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(sourceBindingShowHelp.stdout, "APP_REF");

  const sourceBindingRevokeHelp = run(process.execPath, [proofDevBin, "liskov", "application", "source-binding", "revoke", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(sourceBindingRevokeHelp.stdout, "--expected-revision");
  assertIncludes(sourceBindingRevokeHelp.stdout, "--reason");
  assertIncludes(sourceBindingRevokeHelp.stdout, "--yes");

  const applicationResumeHelp = run(process.execPath, [proofDevBin, "liskov", "application", "resume", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationResumeHelp.stdout, "Resume new Liskov work");
  assertIncludes(applicationResumeHelp.stdout, "--reason");
  assertIncludes(applicationResumeHelp.stdout, "--yes");

  const applicationImportHelp = run(process.execPath, [proofDevBin, "liskov", "application", "import", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationImportHelp.stdout, "Import a Liskov Application manifest");
  assertIncludes(applicationImportHelp.stdout, "--github");
  assertIncludes(applicationImportHelp.stdout, "--server-fetch");
  const importHelpText = applicationImportHelp.stdout.replace(/\s+/g, " ");
  assertIncludes(importHelpText, "V4 manifest import is closed");
  assertIncludes(importHelpText, "application create");
  assertIncludes(importHelpText, "application source-binding set");
  assertIncludes(importHelpText, "application policy publish");

  const applicationStatusHelp = run(process.execPath, [proofDevBin, "liskov", "application", "status", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationStatusHelp.stdout, "Read Liskov Application status");
  assertIncludes(applicationStatusHelp.stdout, "APPLICATION_ID");

  const applicationPlansHelp = run(process.execPath, [proofDevBin, "liskov", "application", "plans", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationPlansHelp.stdout, "Read Liskov Application execution plans");
  assertIncludes(applicationPlansHelp.stdout, "APPLICATION_ID");

  const applicationLockboxHelp = run(process.execPath, [proofDevBin, "liskov", "application", "lockbox", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLockboxHelp.stdout, "Read Liskov Application secret-grant state");
  assertIncludes(applicationLockboxHelp.stdout, "grant-status");

  const applicationLockboxGrantStatusHelp = run(process.execPath, [proofDevBin, "liskov", "application", "lockbox", "grant-status", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLockboxGrantStatusHelp.stdout, "Read Liskov Application secret grant status");
  assertIncludes(applicationLockboxGrantStatusHelp.stdout, "APPLICATION_ID");

  const applicationLockboxGrantStatusNativeHelp = run(process.execPath, [proofDevBin, "liskov", "application", "lockbox", "grant", "status", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationLockboxGrantStatusNativeHelp.stdout, "Read Liskov Application secret grant status");
  assertIncludes(applicationLockboxGrantStatusNativeHelp.stdout, "APP_REF");

  const applicationDeploymentImportHelp = run(process.execPath, [proofDevBin, "liskov", "application", "deployment", "import", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(applicationDeploymentImportHelp.stdout, "Import an existing Acurast deployment");
  assertIncludes(applicationDeploymentImportHelp.stdout, "--origin");
  assertIncludes(applicationDeploymentImportHelp.stdout, "--yes");

  const runtimeImageWorkflowHelp = run(process.execPath, [proofDevBin, "liskov", "application", "runtime-image", "workflow", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(runtimeImageWorkflowHelp.stdout, "APP_ID");
  assertIncludes(runtimeImageWorkflowHelp.stdout, "--manifest=<value>");
  assertIncludes(runtimeImageWorkflowHelp.stdout, "(required)");
  assertExcludes(runtimeImageWorkflowHelp.stdout, "--organization");

  const manifestValidateHelp = run(process.execPath, [proofDevBin, "liskov", "application", "manifest", "validate", "--help"], { cwd: proofCliRoot, env });
  assertExcludes(manifestValidateHelp.stdout, "--organization");

  const custodyHelp = run(process.execPath, [proofDevBin, "liskov", "custody", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(custodyHelp.stdout, "Operator-only Liskov live custody commands");
  assertIncludes(custodyHelp.stdout, "liskov custody execution");

  const custodySubmitHelp = run(process.execPath, [proofDevBin, "liskov", "custody", "execution", "submit", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(custodySubmitHelp.stdout, "Submit a live custody execution");
  assertIncludes(custodySubmitHelp.stdout, "--yes-spend");

  const custodyRunOneHelp = run(process.execPath, [proofDevBin, "liskov", "custody", "execution", "run-one", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(custodyRunOneHelp.stdout, "Run exactly one guarded server-owned live custody transition");
  assertIncludes(custodyRunOneHelp.stdout, "idempotencyKey copied");
  assertIncludes(custodyRunOneHelp.stdout, "never generate one");

  const custodyMachineCatalogHelp = run(process.execPath, [proofDevBin, "liskov", "custody", "machine", "catalog", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(custodyMachineCatalogHelp.stdout, "Read Acurast machine-class catalog");

  const reconcileHelp = run(process.execPath, [proofDevBin, "liskov", "admin", "executor-operation", "reconcile", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(reconcileHelp.stdout, "Reconcile a provably unsubmitted replacement operation");
  assertIncludes(reconcileHelp.stdout, "--expect-application");
  assertIncludes(reconcileHelp.stdout, "--expect-deployment");
  assertIncludes(reconcileHelp.stdout, "--expect-job");
  assertIncludes(reconcileHelp.stdout, "--yes");
  assertExcludes(reconcileHelp.stdout, "--organization <selector>");

  const deploySpendResolveHelp = run(process.execPath, [proofDevBin, "liskov", "admin", "deploy-spend", "resolve", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(deploySpendResolveHelp.stdout, "Resolve a deploy-spend review hold");
  assertIncludes(deploySpendResolveHelp.stdout, "--expect-billing-transaction");
  assertIncludes(deploySpendResolveHelp.stdout, "--final-usd-micros");
  assertIncludes(deploySpendResolveHelp.stdout, "--evidence-sha256");
  assertIncludes(deploySpendResolveHelp.stdout, "--yes");

  const adjudicateHelp = run(process.execPath, [proofDevBin, "liskov", "admin", "retirement", "adjudicate-lineage", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(adjudicateHelp.stdout, "Adjudicate one review-blocked retirement lineage");
  assertIncludes(adjudicateHelp.stdout, "--operation");
  assertIncludes(adjudicateHelp.stdout, "--fingerprint");
  assertIncludes(adjudicateHelp.stdout, "--confirm");
  assertExcludes(adjudicateHelp.stdout, "--organization <selector>");

  const whoamiHelp = run(process.execPath, [proofDevBin, "liskov", "whoami", "--help"], { cwd: proofCliRoot, env });
  assertIncludes(whoamiHelp.stdout, "Read the current Liskov CLI session");
  assertIncludes(whoamiHelp.stdout, "--json");
  assertIncludes(whoamiHelp.stdout, "--organization <selector>");

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

function assertExcludes(value, forbidden) {
  if (value.includes(forbidden)) {
    throw new Error(`Expected output to exclude ${JSON.stringify(forbidden)}.\nOutput:\n${value}`);
  }
}

function runAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("built plugin smoke timed out")); }, 30000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (status) => { clearTimeout(timeout); resolve({ status, stdout, stderr }); });
  });
}
