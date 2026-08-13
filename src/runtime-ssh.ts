import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import { isOrganizationListResponse, organizationListPath } from "./organization-client.js";
import {
  canonicalOrganizationId,
  organizationRequestHeaders,
  organizationSelector,
  OrganizationSelectorError
} from "./organization-context.js";
import { DEFAULT_SLIPWAY_URL, resolveSlipwaySessionFile, type SlipwaySessionFile } from "./session.js";

export interface RuntimeSshCliOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  organization?: string;
  readSecret?: (prompt: string) => Promise<string>;
  confirmHostKey?: (prompt: string) => Promise<boolean>;
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
  organizationId?: string;
  integrationId?: string;
}

export interface RuntimeSshIntegrationCreateInput extends RuntimeSshIntegrationInput {
  name: string;
  tailnet: string;
  tag: string;
  oauthClientId: string;
}

export interface RuntimeSshIntegrationRotateInput extends RuntimeSshIntegrationInput {
  integrationId?: string;
  oauthClientId: string;
}

export interface RuntimeSshOperatorKeyInput extends RuntimeSshCommandInput {
  organizationId?: string;
  keyId?: string;
}

export interface RuntimeSshOperatorKeyAddInput extends RuntimeSshOperatorKeyInput {
  name: string;
  /** Private-key path whose public half is derived, as `liskov ssh --identity` does. */
  identity?: string;
  /** Public-key file, or `-` to read the key from stdin. */
  publicKeyFile?: string;
}

export interface RuntimeSshConnectionInput extends RuntimeSshCommandInput {
  acceptHostKey?: boolean;
  applicationRef: string;
  cliBin?: string;
  deploymentId?: string;
  identity?: string;
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

interface RuntimeSshOperatorKey {
  keyId: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  addedBy: string;
  createdAtMs: number;
}

interface OperatorKeyResponse {
  ok?: boolean;
  error?: string;
  key?: RuntimeSshOperatorKey;
  keys?: RuntimeSshOperatorKey[];
  removed?: RuntimeSshOperatorKey;
  /** The server's standing reminder that a registry removal is not a revocation. */
  note?: string;
}

interface TailscaleConnection {
  provider: "tailscale";
  attachmentId: string;
  deploymentId: string;
  jobId: string;
  expectedTailnet: string;
  hostname: string;
  user: "root";
  port: 22;
  command: ["tailscale", "ssh", string];
}

interface ManagedConnection {
  provider: "liskov";
  attachmentId: string;
  applicationId: string;
  applicationUid: string;
  liskovDeploymentId: string;
  deploymentId: string;
  liskovJobId: string;
  jobId: string;
  user: "root";
  port: 22;
  authorizedKeyFingerprints: string[];
  host: { publicKey: string; fingerprint: string; signedEvidence: string };
  trust: {
    claim: string;
    runtimeContactSha256: string;
    dropbearVersion: string;
    dropbearSha256: string;
    dropbearkeySha256: string;
  };
}

type RuntimeSshConnection = TailscaleConnection | ManagedConnection;

interface ConnectionResponse {
  ok?: boolean;
  error?: string;
  candidates?: Array<{ attachmentId: string; deploymentId: string; jobId: string }>;
  connection?: RuntimeSshConnection;
}

interface ManagedTicketResponse {
  ok?: boolean;
  error?: string;
  ticket?: {
    gatewayUrl: string;
    tunnelId: string;
    protocol: "liskov-access.v1";
    bearerToken: string;
    expiresAtMs: number;
    limits: { maxFrameBytes: number; maxBytesPerDirection: number; maxDurationMs: number };
  };
}

interface TailscaleStatus {
  CurrentTailnet?: { Name?: string };
}

export async function runRuntimeSshIntegrationList(
  input: RuntimeSshIntegrationInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const organization = await resolveRuntimeSshOrganization(input, options);
  if (!organization.ok) return organization.exitCode;
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "GET",
    path: integrationCollectionPath(organization.organizationId),
    organizationSelector: null
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
  const organization = await resolveRuntimeSshOrganization(input, options);
  if (!organization.ok) return organization.exitCode;
  const secret = await readRequiredSecret("Tailscale OAuth client secret: ", options);
  if (!secret.ok) return secret.exitCode;
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "POST",
    path: integrationCollectionPath(organization.organizationId),
    organizationSelector: null,
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
  input: RuntimeSshIntegrationInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const integrationId = requiredIntegrationId(input, options);
  if (!integrationId.ok) return integrationId.exitCode;
  const organization = await resolveRuntimeSshOrganization(input, options);
  if (!organization.ok) return organization.exitCode;
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "POST",
    path: `${integrationPath(organization.organizationId, integrationId.integrationId)}/validate`,
    organizationSelector: null,
    body: {}
  });
  return integrationMutationResult(input.json, options, response, "validated");
}

export async function runRuntimeSshIntegrationRotate(
  input: RuntimeSshIntegrationRotateInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const integrationId = requiredIntegrationId(input, options);
  if (!integrationId.ok) return integrationId.exitCode;
  const organization = await resolveRuntimeSshOrganization(input, options);
  if (!organization.ok) return organization.exitCode;
  const secret = await readRequiredSecret("New Tailscale OAuth client secret: ", options);
  if (!secret.ok) return secret.exitCode;
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "POST",
    path: `${integrationPath(organization.organizationId, integrationId.integrationId)}/rotate`,
    organizationSelector: null,
    body: { oauthClientId: input.oauthClientId, oauthClientSecret: secret.value }
  });
  secret.value = "";
  return integrationMutationResult(input.json, options, response, "rotated");
}

export async function runRuntimeSshIntegrationDisable(
  input: RuntimeSshIntegrationInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const integrationId = requiredIntegrationId(input, options);
  if (!integrationId.ok) return integrationId.exitCode;
  const organization = await resolveRuntimeSshOrganization(input, options);
  if (!organization.ok) return organization.exitCode;
  const response = await runtimeSshRequest<IntegrationResponse>(input, options, {
    method: "DELETE",
    path: integrationPath(organization.organizationId, integrationId.integrationId),
    organizationSelector: null,
    body: {}
  });
  return integrationMutationResult(input.json, options, response, "disabled");
}

export async function runRuntimeSshOperatorKeyList(
  input: RuntimeSshOperatorKeyInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const organization = await resolveRuntimeSshOrganization(input, options);
  if (!organization.ok) return organization.exitCode;
  const response = await runtimeSshRequest<OperatorKeyResponse>(input, options, {
    method: "GET",
    path: operatorKeyCollectionPath(organization.organizationId),
    organizationSelector: null
  });
  if (!response.ok) return response.exitCode;
  if (!response.response.ok || response.body?.ok !== true || !Array.isArray(response.body.keys)) {
    return apiFailure(input.json, options, response.response.status, response.body?.error);
  }
  writeOutput(input.json, options, response.body, response.body.keys.length === 0
    ? "No operator keys. Add an ssh-ed25519 public key, then list it in an application policy."
    : response.body.keys.map(formatOperatorKey).join("\n"));
  return 0;
}

export async function runRuntimeSshOperatorKeyAdd(
  input: RuntimeSshOperatorKeyAddInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  // Read the key before resolving the organization: a malformed key is a local
  // mistake and should not cost a round-trip to report.
  const publicKey = await readOperatorPublicKey(input, options);
  if (!publicKey.ok) return publicKey.exitCode;
  const organization = await resolveRuntimeSshOrganization(input, options);
  if (!organization.ok) return organization.exitCode;
  const response = await runtimeSshRequest<OperatorKeyResponse>(input, options, {
    method: "POST",
    path: operatorKeyCollectionPath(organization.organizationId),
    organizationSelector: null,
    body: { name: input.name, publicKey: publicKey.publicKey }
  });
  if (!response.ok) return response.exitCode;
  if (!response.response.ok || response.body?.ok !== true || !response.body.key) {
    return apiFailure(input.json, options, response.response.status, response.body?.error);
  }
  writeOutput(input.json, options, response.body, [
    `Operator key added: ${formatOperatorKey(response.body.key)}`,
    "Adding a key does not grant access. List it in the application policy's ingress.ssh.provider.authorizedKeys and deploy."
  ].join("\n"));
  return 0;
}

export async function runRuntimeSshOperatorKeyRemove(
  input: RuntimeSshOperatorKeyInput,
  options: RuntimeSshCliOptions = {}
): Promise<number> {
  const keyId = requiredOperatorKeyId(input, options);
  if (!keyId.ok) return keyId.exitCode;
  const organization = await resolveRuntimeSshOrganization(input, options);
  if (!organization.ok) return organization.exitCode;
  const response = await runtimeSshRequest<OperatorKeyResponse>(input, options, {
    method: "DELETE",
    path: operatorKeyPath(organization.organizationId, keyId.keyId),
    organizationSelector: null,
    body: {}
  });
  if (!response.ok) return response.exitCode;
  if (!response.response.ok || response.body?.ok !== true || !response.body.removed) {
    return apiFailure(input.json, options, response.response.status, response.body?.error);
  }
  // The non-revocation note travels on both paths: under --json it is part of
  // the body the server sent, and here it is printed explicitly. Removing a
  // registry row does not revoke anything a policy already authorizes.
  writeOutput(input.json, options, response.body, [
    `Operator key removed from the registry: ${formatOperatorKey(response.body.removed)}`,
    response.body.note
      ?? "Removal does not revoke access on deployed policies; update each policy's authorizedKeys and redeploy to do that."
  ].join("\n"));
  return 0;
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
    return localFailure(input.json, options, "RUNTIME_SSH_CONNECTION_INVALID", "Liskov returned an invalid Runtime SSH connection descriptor.");
  }

  return connection.provider === "tailscale"
    ? await runTailscaleConnection(input, options, connection)
    : await runManagedConnection(input, options, connection);
}

async function runTailscaleConnection(
  input: RuntimeSshConnectionInput,
  options: RuntimeSshCliOptions,
  connection: TailscaleConnection
): Promise<number> {
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

async function runManagedConnection(
  input: RuntimeSshConnectionInput,
  options: RuntimeSshCliOptions,
  connection: ManagedConnection
): Promise<number> {
  const identity = input.identity?.trim();
  if (!identity) {
    return localFailure(input.json, options, "RUNTIME_SSH_IDENTITY_REQUIRED", "Managed Runtime SSH requires --identity with a customer-owned Ed25519 private key path.");
  }
  const runner = options.runProcess ?? defaultProcessRunner;
  const selectedKey = await readIdentityPublicKey(identity, runner);
  if (!selectedKey.ok) {
    return localFailure(input.json, options, selectedKey.error, selectedKey.message);
  }
  const selectedFingerprint = sshFingerprint(selectedKey.publicKey);
  if (!connection.authorizedKeyFingerprints.includes(selectedFingerprint)) {
    return localFailure(input.json, options, "RUNTIME_SSH_IDENTITY_NOT_AUTHORIZED", `The selected identity fingerprint ${selectedFingerprint} is not authorized by this runtime policy. Access comes from the policy, not the operator-key registry: add this key to the application policy's ingress.ssh.provider.authorizedKeys and deploy.`);
  }

  const alias = `liskov-runtime-ssh-${connection.attachmentId}`;
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env: options.env });
  const knownHostsFile = path.join(path.dirname(sessionFile), "runtime-ssh-known-hosts");
  const known = await inspectKnownHost(knownHostsFile, alias, connection.host.publicKey);
  if (!known.ok) {
    return localFailure(input.json, options, known.error, known.message);
  }

  if (input.printCommand) {
    writeOutput(input.json, options, {
      ok: true,
      connection: {
        provider: "liskov",
        attachmentId: connection.attachmentId,
        applicationId: connection.applicationId,
        applicationUid: connection.applicationUid,
        liskovDeploymentId: connection.liskovDeploymentId,
        deploymentId: connection.deploymentId,
        liskovJobId: connection.liskovJobId,
        jobId: connection.jobId,
        hostFingerprint: connection.host.fingerprint,
        selectedIdentityFingerprint: selectedFingerprint,
        trust: connection.trust
      },
      command: "managed Runtime SSH (one-time ticket minted only when connecting)"
    }, `managed Runtime SSH root@${connection.applicationUid} (${connection.deploymentId}/${connection.jobId}); one-time ticket not minted`);
    return 0;
  }

  if (!known.exists) {
    writeHostTrustNotice(options, connection, selectedFingerprint);
    const accepted = input.acceptHostKey === true || await confirmHostKey(options, input.json);
    if (!accepted) {
      return localFailure(input.json, options, "RUNTIME_SSH_HOST_KEY_NOT_ACCEPTED", "The managed runtime host key was not accepted.");
    }
    const persisted = await persistKnownHost(knownHostsFile, alias, connection.host.publicKey);
    if (!persisted.ok) {
      return localFailure(input.json, options, persisted.error, persisted.message);
    }
  }

  const ticketResponse = await runtimeSshRequest<ManagedTicketResponse>(input, options, {
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/runtime-ssh/attachments/${encodeURIComponent(connection.attachmentId)}/tickets`,
    body: {
      selectedPublicKey: selectedKey.publicKey,
      confirmedHostFingerprint: connection.host.fingerprint
    }
  });
  if (!ticketResponse.ok) return ticketResponse.exitCode;
  const ticket = ticketResponse.body?.ticket;
  if (!ticketResponse.response.ok || ticketResponse.body?.ok !== true || !validManagedTicket(ticket)) {
    return apiFailure(input.json, options, ticketResponse.response.status, ticketResponse.body?.error);
  }

  const ticketDirectory = await mkdtemp(path.join(path.dirname(sessionFile), ".runtime-ssh-ticket-"));
  const ticketFile = path.join(ticketDirectory, "operator.token");
  await writeFile(ticketFile, ticket.bearerToken, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(ticketFile, 0o600);
  const proxyCommand = [
    input.cliBin ?? "proof",
    "liskov", "access", "proxy",
    "--gateway", ticket.gatewayUrl,
    "--tunnel-id", ticket.tunnelId,
    "--token-file", ticketFile
  ].map(shellQuote).join(" ");
  const sshArgs = [
    "-F", "/dev/null",
    "-i", identity,
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHostsFile}`,
    "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", `HostKeyAlias=${alias}`,
    "-o", "ClearAllForwardings=yes",
    "-o", "ForwardAgent=no",
    "-o", "ForwardX11=no",
    "-o", "ForwardX11Trusted=no",
    "-o", "PermitLocalCommand=no",
    "-o", `ProxyCommand=${proxyCommand}`,
    "-p", "22",
    "root@127.0.0.1"
  ] as const;
  const removeSignalCleanup = installSignalCleanup(ticketDirectory);
  try {
    const result = await runner("ssh", sshArgs, "inherit");
    return result.exitCode;
  } catch (error) {
    return localFailure(input.json, options, "RUNTIME_SSH_OPENSSH_FAILED", `Could not start OpenSSH: ${errorMessage(error)}`);
  } finally {
    removeSignalCleanup();
    await rm(ticketDirectory, { recursive: true, force: true });
  }
}

async function runtimeSshRequest<T>(
  input: RuntimeSshCommandInput,
  options: RuntimeSshCliOptions,
  request: {
    method: "DELETE" | "GET" | "POST";
    path: string;
    body?: unknown;
    organizationSelector?: string | null;
  }
): Promise<{ ok: true; response: Response; body?: T } | { ok: false; exitCode: number }> {
  let requestOrganization: string | undefined;
  try {
    requestOrganization = organizationSelector(
      request.organizationSelector === undefined ? options.organization : request.organizationSelector ?? undefined
    );
  } catch (error) {
    return { ok: false, exitCode: organizationSelectorFailure(input.json, options, error) };
  }
  const context = await runtimeSshContext(input, options);
  if (!context.ok) return context;
  let headers: Record<string, string>;
  try {
    headers = organizationRequestHeaders(
      context.session.sessionToken,
      requestOrganization
    );
  } catch (error) {
    return { ok: false, exitCode: organizationSelectorFailure(input.json, options, error) };
  }
  const init: RequestInit = {
    method: request.method,
    headers: {
      ...headers,
      ...(request.body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
  };
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(new URL(request.path, context.baseUrl), init);
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

async function resolveRuntimeSshOrganization(
  input: RuntimeSshIntegrationInput,
  options: RuntimeSshCliOptions
): Promise<{ ok: true; organizationId: string } | { ok: false; exitCode: number }> {
  let selector: string;
  try {
    selector = organizationSelector(input.organizationId ?? options.organization, { required: true })!;
  } catch (error) {
    return { ok: false, exitCode: organizationSelectorFailure(input.json, options, error) };
  }
  const context = await runtimeSshContext(input, options);
  if (!context.ok) return context;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(new URL(organizationListPath(), context.baseUrl), {
      method: "GET",
      headers: organizationRequestHeaders(context.session.sessionToken, undefined)
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: localFailure(input.json, options, "RUNTIME_SSH_REQUEST_FAILED", `Could not resolve the Liskov organization: ${errorMessage(error)}`)
    };
  }
  const body = await readRuntimeSshJson(response);
  if (!response.ok) {
    return {
      ok: false,
      exitCode: apiFailure(
        input.json,
        options,
        response.status,
        typeof body?.error === "string" ? body.error : undefined
      )
    };
  }
  if (!isOrganizationListResponse(body)) {
    return { ok: false, exitCode: localFailure(input.json, options, "RUNTIME_SSH_ORGANIZATION_RESPONSE_INVALID", "Liskov returned an invalid organization list.") };
  }
  const organizationId = canonicalOrganizationId(selector, body.organizations);
  if (organizationId === undefined) {
    return { ok: false, exitCode: localFailure(input.json, options, "not_a_member", `No active organization membership exactly matches ${selector}.`) };
  }
  return { ok: true, organizationId };
}

async function runtimeSshContext(
  input: RuntimeSshCommandInput,
  options: RuntimeSshCliOptions
): Promise<{ ok: true; session: SlipwaySessionFile; baseUrl: URL } | { ok: false; exitCode: number }> {
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
  try {
    return { ok: true, session, baseUrl: new URL(input.slipwayUrl ?? session.slipwayUrl ?? DEFAULT_SLIPWAY_URL) };
  } catch {
    return { ok: false, exitCode: localFailure(input.json, options, "SLIPWAY_URL_INVALID", "The Liskov service URL is invalid.") };
  }
}

async function readRuntimeSshJson(response: Response): Promise<Record<string, unknown> | undefined> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function organizationSelectorFailure(json: boolean | undefined, options: RuntimeSshCliOptions, error: unknown): number {
  if (!(error instanceof OrganizationSelectorError)) throw error;
  return localFailure(json, options, error.code, error.message);
}

function requiredIntegrationId(
  input: RuntimeSshIntegrationInput,
  options: RuntimeSshCliOptions
): { ok: true; integrationId: string } | { ok: false; exitCode: number } {
  const integrationId = input.integrationId?.trim();
  if (!integrationId) {
    return {
      ok: false,
      exitCode: localFailure(input.json, options, "RUNTIME_SSH_INTEGRATION_ID_REQUIRED", "Provide a Runtime SSH integration ID.")
    };
  }
  return { ok: true, integrationId };
}

function requiredOperatorKeyId(
  input: RuntimeSshOperatorKeyInput,
  options: RuntimeSshCliOptions
): { ok: true; keyId: string } | { ok: false; exitCode: number } {
  const keyId = input.keyId?.trim();
  if (!keyId) {
    return {
      ok: false,
      exitCode: localFailure(input.json, options, "RUNTIME_SSH_OPERATOR_KEY_ID_REQUIRED", "Provide an operator key ID. Run `liskov runtime-ssh operator-key list` to see them.")
    };
  }
  return { ok: true, keyId };
}

/// An operator public key is not a secret, so it is read as ordinary input —
/// never through the protected-prompt path used for OAuth client secrets.
async function readOperatorPublicKey(
  input: RuntimeSshOperatorKeyAddInput,
  options: RuntimeSshCliOptions
): Promise<{ ok: true; publicKey: string } | { ok: false; exitCode: number }> {
  const identity = input.identity?.trim();
  const publicKeyFile = input.publicKeyFile?.trim();
  if (identity && publicKeyFile) {
    return { ok: false, exitCode: localFailure(input.json, options, "RUNTIME_SSH_OPERATOR_KEY_SOURCE_CONFLICT", "Provide either --identity or --public-key-file, not both.") };
  }
  if (identity) {
    const derived = await readIdentityPublicKey(identity, options.runProcess ?? defaultProcessRunner);
    if (!derived.ok) return { ok: false, exitCode: localFailure(input.json, options, derived.error, derived.message) };
    return { ok: true, publicKey: derived.publicKey };
  }
  if (!publicKeyFile) {
    return { ok: false, exitCode: localFailure(input.json, options, "RUNTIME_SSH_OPERATOR_KEY_SOURCE_REQUIRED", "Provide the public key with --identity <private-key-path> or --public-key-file <path|->.") };
  }
  let value: string;
  try {
    value = publicKeyFile === "-" ? await readAllStdin() : await readFile(publicKeyFile, "utf8");
  } catch (error) {
    return { ok: false, exitCode: localFailure(input.json, options, "RUNTIME_SSH_OPERATOR_KEY_FILE_UNREADABLE", `Could not read the public key: ${errorMessage(error)}`) };
  }
  try {
    return { ok: true, publicKey: normalizeEd25519PublicKey(value) };
  } catch {
    return { ok: false, exitCode: localFailure(input.json, options, "RUNTIME_SSH_OPERATOR_KEY_NOT_ED25519", "The operator key must be a canonical ssh-ed25519 public key.") };
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
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

function formatOperatorKey(key: RuntimeSshOperatorKey): string {
  return `${key.keyId}\t${key.name}\t${key.fingerprint}\t${key.addedBy}\t${key.createdAtMs}`;
}

function validConnection(connection: ConnectionResponse["connection"]): connection is RuntimeSshConnection {
  if (!connection) return false;
  if (connection.provider === "tailscale") {
    const hostname = connection.hostname;
    return connection.user === "root"
      && connection.port === 22
      && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/iu.test(hostname)
      && connection.command.length === 3
      && connection.command[0] === "tailscale"
      && connection.command[1] === "ssh"
      && connection.command[2] === `root@${hostname}`;
  }
  if (connection.provider !== "liskov") return false;
  const ids = [
    connection.attachmentId, connection.applicationId, connection.applicationUid,
    connection.liskovDeploymentId, connection.deploymentId, connection.liskovJobId,
    connection.jobId
  ];
  if (connection.user !== "root" || connection.port !== 22 || !ids.every(validDescriptorId)) return false;
  let hostFingerprint: string;
  try {
    const normalizedHostKey = normalizeEd25519PublicKey(connection.host.publicKey);
    if (normalizedHostKey !== connection.host.publicKey) return false;
    hostFingerprint = sshFingerprint(normalizedHostKey);
  } catch {
    return false;
  }
  return hostFingerprint === connection.host.fingerprint
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(connection.host.signedEvidence)
    && connection.host.signedEvidence.length <= 16_384
    && Array.isArray(connection.authorizedKeyFingerprints)
    && connection.authorizedKeyFingerprints.length >= 1
    && connection.authorizedKeyFingerprints.length <= 8
    && new Set(connection.authorizedKeyFingerprints).size === connection.authorizedKeyFingerprints.length
    && connection.authorizedKeyFingerprints.every((value) => /^SHA256:[A-Za-z0-9+/]{43}$/u.test(value))
    && connection.trust.claim === "Liskov-supplied runtime-contact and Dropbear binaries were digest verified; the customer runtime image is not attested"
    && validSha256(connection.trust.runtimeContactSha256)
    && validSha256(connection.trust.dropbearSha256)
    && validSha256(connection.trust.dropbearkeySha256)
    && typeof connection.trust.dropbearVersion === "string"
    && connection.trust.dropbearVersion.length >= 1
    && connection.trust.dropbearVersion.length <= 64;
}

async function readIdentityPublicKey(
  identity: string,
  runner: RuntimeSshProcessRunner
): Promise<{ ok: true; publicKey: string } | { ok: false; error: string; message: string }> {
  let value: string;
  try {
    value = await readFile(`${identity}.pub`, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      return { ok: false, error: "RUNTIME_SSH_IDENTITY_PUBLIC_KEY_FAILED", message: `Could not read the identity's .pub companion: ${errorMessage(error)}` };
    }
    let result: RuntimeSshProcessResult;
    try {
      result = await runner("ssh-keygen", ["-y", "-f", identity], "capture");
    } catch (spawnError) {
      return { ok: false, error: "RUNTIME_SSH_IDENTITY_PUBLIC_KEY_FAILED", message: `Could not derive the identity public key with ssh-keygen: ${errorMessage(spawnError)}` };
    }
    if (result.exitCode !== 0) {
      return { ok: false, error: "RUNTIME_SSH_IDENTITY_PUBLIC_KEY_FAILED", message: "ssh-keygen could not derive an Ed25519 public key from the selected identity." };
    }
    value = result.stdout;
  }
  try {
    return { ok: true, publicKey: normalizeEd25519PublicKey(value) };
  } catch {
    return { ok: false, error: "RUNTIME_SSH_IDENTITY_NOT_ED25519", message: "The selected identity must have a canonical Ed25519 public key." };
  }
}

function normalizeEd25519PublicKey(value: string): string {
  const parts = value.trim().split(/\s+/u);
  if (parts.length < 2 || parts[0] !== "ssh-ed25519") throw new Error("not Ed25519");
  const blob = Buffer.from(parts[1], "base64");
  if (
    blob.length !== 51
    || blob.readUInt32BE(0) !== 11
    || blob.subarray(4, 15).toString("ascii") !== "ssh-ed25519"
    || blob.readUInt32BE(15) !== 32
    || blob.toString("base64") !== parts[1]
  ) throw new Error("malformed Ed25519 key");
  return `ssh-ed25519 ${parts[1]}`;
}

function sshFingerprint(publicKey: string): string {
  const encoded = normalizeEd25519PublicKey(publicKey).split(" ")[1];
  return `SHA256:${createHash("sha256").update(Buffer.from(encoded, "base64")).digest("base64").replace(/=+$/u, "")}`;
}

async function inspectKnownHost(
  knownHostsFile: string,
  alias: string,
  publicKey: string
): Promise<{ ok: true; exists: boolean } | { ok: false; error: string; message: string }> {
  try {
    const metadata = await lstat(knownHostsFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
      return { ok: false, error: "RUNTIME_SSH_KNOWN_HOSTS_UNSAFE", message: `The Liskov known_hosts file must be a regular mode-0600 file: ${knownHostsFile}` };
    }
    const content = await readFile(knownHostsFile, "utf8");
    const entries = content.split("\n").filter((line) => line.split(/\s+/u)[0] === alias);
    if (entries.some((line) => line !== `${alias} ${publicKey}`)) {
      return { ok: false, error: "RUNTIME_SSH_HOST_KEY_MISMATCH", message: `The pinned host key for ${alias} does not match the signed runtime host evidence.` };
    }
    return { ok: true, exists: entries.length > 0 };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { ok: true, exists: false };
    return { ok: false, error: "RUNTIME_SSH_KNOWN_HOSTS_READ_FAILED", message: `Could not inspect the Liskov known_hosts file: ${errorMessage(error)}` };
  }
}

async function persistKnownHost(
  knownHostsFile: string,
  alias: string,
  publicKey: string
): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  const inspected = await inspectKnownHost(knownHostsFile, alias, publicKey);
  if (!inspected.ok) return inspected;
  if (inspected.exists) return { ok: true };
  try {
    const directory = path.dirname(knownHostsFile);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let existing = "";
    try {
      existing = await readFile(knownHostsFile, "utf8");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
    const suffix = existing === "" || existing.endsWith("\n") ? "" : "\n";
    const temporary = path.join(directory, `.runtime-ssh-known-hosts-${randomBytes(12).toString("hex")}.tmp`);
    await writeFile(temporary, `${existing}${suffix}${alias} ${publicKey}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, knownHostsFile);
    await chmod(knownHostsFile, 0o600);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "RUNTIME_SSH_KNOWN_HOSTS_WRITE_FAILED", message: `Could not atomically pin the managed runtime host key: ${errorMessage(error)}` };
  }
}

function writeHostTrustNotice(
  options: RuntimeSshCliOptions,
  connection: ManagedConnection,
  selectedFingerprint: string
): void {
  const message = [
    "Managed Runtime SSH first-use host-key confirmation:",
    `  application: ${connection.applicationId} (${connection.applicationUid})`,
    `  deployment: ${connection.liskovDeploymentId} / ${connection.deploymentId}`,
    `  job: ${connection.liskovJobId} / ${connection.jobId}`,
    `  host key: ${connection.host.fingerprint}`,
    `  identity: ${selectedFingerprint}`,
    `  trust: ${connection.trust.claim}`
  ].join("\n");
  (options.stderr ?? console.error)(message);
}

async function confirmHostKey(options: RuntimeSshCliOptions, json: boolean | undefined): Promise<boolean> {
  if (options.confirmHostKey) return await options.confirmHostKey("Accept and pin this host key? [yes/no] ");
  if (json || !process.stdin.isTTY || !process.stderr.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return (await terminal.question("Accept and pin this host key? Type yes to continue: ")).trim().toLowerCase() === "yes";
  } finally {
    terminal.close();
  }
}

function validManagedTicket(ticket: ManagedTicketResponse["ticket"]): ticket is NonNullable<ManagedTicketResponse["ticket"]> {
  if (!ticket) return false;
  let gateway: URL;
  try {
    gateway = new URL(ticket.gatewayUrl);
  } catch {
    return false;
  }
  return gateway.protocol === "wss:"
    && gateway.hostname !== ""
    && gateway.username === ""
    && gateway.password === ""
    && gateway.pathname === "/"
    && gateway.search === ""
    && gateway.hash === ""
    && /^[A-Za-z0-9_-]{1,256}$/u.test(ticket.tunnelId)
    && ticket.protocol === "liskov-access.v1"
    && /^[\x21-\x7e]{1,16384}$/u.test(ticket.bearerToken)
    && Number.isSafeInteger(ticket.expiresAtMs)
    && ticket.expiresAtMs > Date.now()
    && ticket.limits.maxFrameBytes === 65_536
    && ticket.limits.maxBytesPerDirection === 1_073_741_824
    && ticket.limits.maxDurationMs === 7_200_000;
}

function shellQuote(value: string): string {
  if (value.includes("\0")) throw new Error("NUL is not shell-safe");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function installSignalCleanup(directory: string): () => void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const handler = (): void => {
      for (const [registeredSignal, registered] of handlers) process.off(registeredSignal, registered);
      void rm(directory, { recursive: true, force: true }).finally(() => process.kill(process.pid, signal));
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

function validDescriptorId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 512 && !/[\0-\x1f\x7f]/u.test(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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

function operatorKeyCollectionPath(organizationId: string): string {
  return `/api/organizations/${encodeURIComponent(organizationId)}/runtime-ssh/operator-keys`;
}

function operatorKeyPath(organizationId: string, keyId: string): string {
  return `${operatorKeyCollectionPath(organizationId)}/${encodeURIComponent(keyId)}`;
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
