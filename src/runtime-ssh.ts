import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { emitKeypressEvents } from "node:readline";

import { DEFAULT_SLIPWAY_URL, resolveSlipwaySessionFile, type SlipwaySessionFile } from "./session.js";

export interface RuntimeSshCliOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  readSecret?: (prompt: string) => Promise<string>;
  runProcess?: RuntimeSshProcessRunner;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface RuntimeSshCommandInput {
  config?: string;
  slipwayUrl?: string;
  json?: boolean;
}

export interface RuntimeSshIntegrationInput extends RuntimeSshCommandInput {
  organizationId: string;
  integrationId?: string;
}

export interface RuntimeSshIntegrationCreateInput extends RuntimeSshIntegrationInput {
  name: string;
  tailnet: string;
  tag: string;
  oauthClientId: string;
}

export interface RuntimeSshIntegrationRotateInput extends RuntimeSshIntegrationInput {
  integrationId: string;
  oauthClientId: string;
}

export interface RuntimeSshConnectionInput extends RuntimeSshCommandInput {
  applicationRef: string;
  deploymentId?: string;
  jobId?: string;
  printCommand?: boolean;
}

export interface RuntimeSshProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RuntimeSshProcessRunner = (
  executable: string,
  args: readonly string[],
  mode: "capture" | "inherit"
) => Promise<RuntimeSshProcessResult>;

interface RuntimeSshIntegration {
  integrationId: string;
  kind: "tailscale";
  name: string;
  tailnet: string;
  tag: string;
  credentialVersion: number;
  lifecycle: "enabled" | "disabled";
  validation: "pending" | "valid" | "invalid";
  validationErrorCode?: string;
}

interface IntegrationResponse {
  ok?: boolean;
  error?: string;
  integration?: RuntimeSshIntegration;
  integrations?: RuntimeSshIntegration[];
}

interface ConnectionResponse {
  ok?: boolean;
  error?: string;
  candidates?: Array<{ attachmentId: string; deploymentId: string; jobId: string }>;
  connection?: {
    provider: "tailscale";
    attachmentId: string;
    deploymentId: string;
    jobId: string;
    expectedTailnet: string;
    hostname: string;
    user: "root";
    port: 22;
    command: ["tailscale", "ssh", string];
  };
}

interface TailscaleStatus {
  CurrentTailnet?: { Name?: string };
}

export async function runRuntimeSshIntegrationList(
  input: RuntimeSshIntegrationInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "GET",
    path: integrationCollectionPath(input.organizationId)
  });
  if (!response.ok) return response.exitCode;
  if (!response.response.ok || response.body?.ok !== true || !Array.isArray(response.body.integrations)) {
    return apiFailure(input.json, options, response.response.status, response.body?.error);
  }
  writeOutput(input.json, options, response.body, response.body.integrations.length === 0
    ? "No Runtime SSH integrations. Connect your Tailscale account/tailnet to create one."
    : response.body.integrations.map(formatIntegration).join("\n"));
  return 0;
}

export async function runRuntimeSshIntegrationCreate(
  input: RuntimeSshIntegrationCreateInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const secret = await readRequiredSecret("Tailscale OAuth client secret: ", options);
  if (!secret.ok) return secret.exitCode;
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "POST",
    path: integrationCollectionPath(input.organizationId),
    body: {
      kind: "tailscale",
      name: input.name,
      tailnet: input.tailnet,
      tag: input.tag,
      oauthClientId: input.oauthClientId,
      oauthClientSecret: secret.value
    }
  });
  secret.value = "";
  return integrationMutationResult(input.json, options, response, "created");
}

export async function runRuntimeSshIntegrationValidate(
  input: RuntimeSshIntegrationInput & { integrationId: string },
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "POST",
    path: `${integrationPath(input.organizationId, input.integrationId)}/validate`,
    body: {}
  });
  return integrationMutationResult(input.json, options, response, "validated");
}

export async function runRuntimeSshIntegrationRotate(
  input: RuntimeSshIntegrationRotateInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const secret = await readRequiredSecret("New Tailscale OAuth client secret: ", options);
  if (!secret.ok) return secret.exitCode;
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "POST",
    path: `${integrationPath(input.organizationId, input.integrationId)}/rotate`,
    body: { oauthClientId: input.oauthClientId, oauthClientSecret: secret.value }
  });
  secret.value = "";
  return integrationMutationResult(input.json, options, response, "rotated");
}

export async function runRuntimeSshIntegrationDisable(
  input: RuntimeSshIntegrationInput & { integrationId: string },
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "DELETE",
    path: integrationPath(input.organizationId, input.integrationId),
    body: {}
  });
  return integrationMutationResult(input.json, options, response, "disabled");
}

export async function runRuntimeSshConnection(
  input: RuntimeSshConnectionInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const response = await runtimeSshRequest<ConnectionResponse>(input, options, {
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/runtime-ssh/connection-requests`,
    body: { deploymentId: input.deploymentId, jobId: input.jobId }
  });
  if (!response.ok) return response.exitCode;
  const connection = response.body?.connection;
  if (!response.response.ok || response.body?.ok !== true || !connection) {
    const hint = response.body?.error === "runtime_ssh_attachment_ambiguous"
      ? " Specify --deployment or --job to select one ready attachment."
      : "";
    return apiFailure(input.json, options, response.response.status, response.body?.error, hint, response.body);
  }
  if (!validConnection(connection)) {
    return localFailure(input.json, options, "RUNTIME_SSH_CONNECTION_INVALID", "Liskov returned an invalid Tailscale connection descriptor.");
  }

  const runner = options.runProcess ?? defaultProcessRunner;
  let statusResult: RuntimeSshProcessResult;
  try {
    statusResult = await runner("tailscale", ["status", "--json"], "capture");
  } catch (error) {
    return localFailure(input.json, options, "TAILSCALE_STATUS_FAILED", `Could not run the local Tailscale client: ${errorMessage(error)}`);
  }
  if (statusResult.exitCode !== 0) {
    return localFailure(input.json, options, "TAILSCALE_NOT_AUTHENTICATED", "The local Tailscale client is not authenticated. Log in to the customer-owned tailnet, then retry.");
  }
  const localTailnet = readCurrentTailnet(statusResult.stdout);
  if (localTailnet !== connection.expectedTailnet) {
    return localFailure(
      input.json,
      options,
      "TAILSCALE_TAILNET_MISMATCH",
      `The local Tailscale client is connected to ${localTailnet ?? "an unknown tailnet"}, but this attachment belongs to ${connection.expectedTailnet}. Switch tailnets yourself, then retry; Liskov will never switch accounts or tailnets automatically.`
    );
  }

  if (input.printCommand) {
    writeOutput(input.json, options, {
      ok: true,
      connection,
      command: connection.command
    }, connection.command.join(" "));
    return 0;
  }

  let sshResult: RuntimeSshProcessResult;
  try {
    sshResult = await runner(connection.command[0], connection.command.slice(1), "inherit");
  } catch (error) {
    return localFailure(input.json, options, "TAILSCALE_SSH_FAILED", `Could not start Tailscale SSH: ${errorMessage(error)}`);
  }
  return sshResult.exitCode;
}

async function runtimeSshRequest<T>(
  input: RuntimeSshCommandInput,
  options: RuntimeSshCliOptions,
  request: { method: "DELETE" | "GET" | "POST"; path: string; body?: unknown }
): Promise<{ ok: true; response: Response; body?: T } | { ok: false; exitCode: number }> {
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env: options.env });
  let session: SlipwaySessionFile;
  try {
    const parsed = JSON.parse(await readFile(sessionFile, "utf8")) as Partial<SlipwaySessionFile>;
    if (parsed.version !== 1 || typeof parsed.slipwayUrl !== "string" || typeof parsed.sessionToken !== "string") {
      throw new Error("session file is not version 1");
    }
    session = parsed as SlipwaySessionFile;
  } catch (error) {
    return { ok: false, exitCode: localFailure(input.json, options, "SLIPWAY_SESSION_NOT_FOUND", `No valid Liskov CLI session was found at ${sessionFile}. Run \`proof liskov login\` first. (${errorMessage(error)})`) };
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(input.slipwayUrl ?? session.slipwayUrl ?? DEFAULT_SLIPWAY_URL);
  } catch {
    return { ok: false, exitCode: localFailure(input.json, options, "SLIPWAY_URL_INVALID", "The Liskov service URL is invalid.") };
  }
  const init: RequestInit = {
    method: request.method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${session.sessionToken}`,
      ...(request.body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
  };
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(new URL(request.path, baseUrl), init);
  } catch (error) {
    return { ok: false, exitCode: localFailure(input.json, options, "RUNTIME_SSH_REQUEST_FAILED", `Could not contact Liskov: ${errorMessage(error)}`) };
  }
  const text = await response.text();
  let body: T | undefined;
  try {
    body = text.trim() ? JSON.parse(text) as T : undefined;
  } catch {
    body = undefined;
  }
  return { ok: true, response, body };
}

async function readRequiredSecret(
  prompt: string,
  options: RuntimeSshCliOptions
): Promise<{ ok: true; value: string } | { ok: false; exitCode: number }> {
  let value: string;
  try {
    value = await (options.readSecret ?? defaultSecretReader)(prompt);
  } catch (error) {
    return { ok: false, exitCode: localFailure(false, options, "RUNTIME_SSH_SECRET_READ_FAILED", `Could not read the OAuth client secret: ${errorMessage(error)}`) };
  }
  value = value.replace(/[\r\n]+$/u, "");
  if (!value) {
    return { ok: false, exitCode: localFailure(false, options, "RUNTIME_SSH_SECRET_REQUIRED", "The OAuth client secret is required on stdin or through the protected prompt.") };
  }
  if (Buffer.byteLength(value, "utf8") > 65_536) {
    value = "";
    return { ok: false, exitCode: localFailure(false, options, "RUNTIME_SSH_SECRET_TOO_LARGE", "The OAuth client secret exceeds the 64 KiB input limit.") };
  }
  return { ok: true, value };
}

async function defaultSecretReader(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 65_536) throw new Error("secret input exceeds 64 KiB");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  if (!process.stdin.setRawMode) throw new Error("protected input is unavailable on this terminal");
  process.stderr.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let secret = "";
    const finish = (error?: Error) => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error); else resolve(secret);
    };
    const onKeypress = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") return finish(new Error("input cancelled"));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") {
        secret = Array.from(secret).slice(0, -1).join("");
        return;
      }
      if (!key.ctrl && text && !/[\r\n]/u.test(text)) secret += text;
    };
    process.stdin.on("keypress", onKeypress);
  });
}

async function defaultProcessRunner(
  executable: string,
  args: readonly string[],
  mode: "capture" | "inherit"
): Promise<RuntimeSshProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: mode === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    const collect = (target: Buffer[], kind: "stdout" | "stderr") => (chunk: Buffer) => {
      const current = kind === "stdout" ? stdoutSize : stderrSize;
      if (current >= 1_048_576) return;
      const bounded = chunk.subarray(0, 1_048_576 - current);
      target.push(bounded);
      if (kind === "stdout") stdoutSize += bounded.length; else stderrSize += bounded.length;
    };
    let timedOut = false;
    const timeout = mode === "capture" ? setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 10_000) : undefined;
    timeout?.unref();
    child.stdout?.on("data", collect(stdout, "stdout"));
    child.stderr?.on("data", collect(stderr, "stderr"));
    child.once("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      resolve({
      exitCode: timedOut ? 124 : code ?? (signal ? 1 : 0),
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function integrationMutationResult(
  json: boolean | undefined,
  options: RuntimeSshCliOptions,
  response: Awaited<ReturnType<typeof runtimeSshRequest<IntegrationResponse>>>,
  verb: string
): number {
  if (!response.ok) return response.exitCode;
  if (!response.response.ok || response.body?.ok !== true || !response.body.integration) {
    return apiFailure(json, options, response.response.status, response.body?.error);
  }
  writeOutput(json, options, response.body, `Runtime SSH integration ${verb}: ${formatIntegration(response.body.integration)}`);
  return 0;
}

function formatIntegration(integration: RuntimeSshIntegration): string {
  return `${integration.integrationId}\t${integration.name}\t${integration.tailnet}\t${integration.tag}\t${integration.lifecycle}\t${integration.validation}`;
}

function validConnection(connection: ConnectionResponse["connection"]): connection is NonNullable<ConnectionResponse["connection"]> {
  if (!connection) return false;
  const hostname = connection.hostname;
  return connection.provider === "tailscale"
    && connection.user === "root"
    && connection.port === 22
    && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/iu.test(hostname)
    && connection.command.length === 3
    && connection.command[0] === "tailscale"
    && connection.command[1] === "ssh"
    && connection.command[2] === `root@${hostname}`;
}

function readCurrentTailnet(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as TailscaleStatus;
    const name = parsed.CurrentTailnet?.Name;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function integrationCollectionPath(organizationId: string): string {
  return `/api/organizations/${encodeURIComponent(organizationId)}/runtime-ssh/integrations`;
}

function integrationPath(organizationId: string, integrationId: string): string {
  return `${integrationCollectionPath(organizationId)}/${encodeURIComponent(integrationId)}`;
}

function apiFailure(
  json: boolean | undefined,
  options: RuntimeSshCliOptions,
  status: number,
  error = "runtime_ssh_request_failed",
  hint = "",
  body?: unknown
): number {
  writeOutput(json, options, body ?? { ok: false, error, status }, `Error (${error}): Runtime SSH request failed with HTTP ${status}.${hint}` , true);
  return 1;
}

function localFailure(json: boolean | undefined, options: RuntimeSshCliOptions, error: string, message: string): number {
  writeOutput(json, options, { ok: false, error, message }, `Error (${error}): ${message}`, true);
  return 1;
}

function writeOutput(json: boolean | undefined, options: RuntimeSshCliOptions, value: unknown, human: string, failure = false): void {
  const line = json ? JSON.stringify(value) : human;
  (failure ? options.stderr : options.stdout)?.(line);
  if (!options.stdout && !options.stderr) (failure ? console.error : console.log)(line);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
