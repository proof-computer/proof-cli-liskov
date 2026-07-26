export interface LiskovOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  avatarColor?: string | null;
  role: string;
}

export interface LiskovServiceCredits {
  availableUsd: number;
  reservedUsd: number;
  usedUsd: number;
  promoUsd: number;
}

export interface LiskovBillingTransaction {
  txId: string;
  orgId: string;
  applicationId?: string | null;
  kind: string;
  asset: string;
  amount: string;
  status: string;
  txRef?: string | null;
  memo?: string | null;
  createdAtMs: number;
}

export interface LiskovOrganizationListResponse {
  ok?: boolean;
  organizations: LiskovOrganizationSummary[];
  [key: string]: unknown;
}

export interface LiskovOrganizationBillingResponse {
  ok?: boolean;
  organization: LiskovOrganizationSummary;
  plan?: { id?: string; name?: string; [key: string]: unknown };
  usage?: { applications?: number; users?: number; meteredSeats?: number };
  nextCharge?: { totalUsd?: number | null; [key: string]: unknown };
  serviceCredits: LiskovServiceCredits;
  transactions?: LiskovBillingTransaction[];
  [key: string]: unknown;
}

export interface LiskovOrganizationServiceCreditsResponse {
  ok?: boolean;
  organizationId: string;
  generatedAtMs: number;
  serviceCredits: LiskovServiceCredits;
  [key: string]: unknown;
}

export interface LiskovOrganizationTransactionsResponse {
  ok?: boolean;
  transactions: LiskovBillingTransaction[];
  [key: string]: unknown;
}

export function organizationListPath(): string {
  return "/api/organizations";
}

export function organizationBillingPath(organizationId: string): string {
  return `/api/organizations/${encodeURIComponent(organizationId)}/billing`;
}

export function organizationServiceCreditsPath(organizationId: string): string {
  return `/api/organizations/${encodeURIComponent(organizationId)}/service-credits`;
}

export function organizationTransactionsPath(
  organizationId: string,
  options: { limit?: number; beforeMs?: number } = {}
): string {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.beforeMs !== undefined) query.set("before", String(options.beforeMs));
  const suffix = query.toString();
  return `/api/organizations/${encodeURIComponent(organizationId)}/billing/transactions${suffix ? `?${suffix}` : ""}`;
}

export function isOrganizationListResponse(value: unknown): value is LiskovOrganizationListResponse {
  const body = record(value);
  return body?.ok === true &&
    Array.isArray(body.organizations) &&
    body.organizations.every(isOrganizationSummary);
}

export function isOrganizationBillingResponse(value: unknown): value is LiskovOrganizationBillingResponse {
  const body = record(value);
  return body?.ok === true &&
    isOrganizationSummary(body.organization) &&
    isServiceCredits(body.serviceCredits) &&
    (body.transactions === undefined ||
      (Array.isArray(body.transactions) && body.transactions.every(isBillingTransaction)));
}

export function isOrganizationServiceCreditsResponse(
  value: unknown
): value is LiskovOrganizationServiceCreditsResponse {
  const body = record(value);
  return body?.ok === true &&
    typeof body.organizationId === "string" &&
    Number.isSafeInteger(body.generatedAtMs) &&
    isServiceCredits(body.serviceCredits);
}

export function isOrganizationTransactionsResponse(
  value: unknown
): value is LiskovOrganizationTransactionsResponse {
  const body = record(value);
  return body?.ok === true &&
    Array.isArray(body.transactions) &&
    body.transactions.every(isBillingTransaction);
}

function isOrganizationSummary(value: unknown): value is LiskovOrganizationSummary {
  const org = record(value);
  return org !== undefined &&
    typeof org.id === "string" &&
    typeof org.name === "string" &&
    typeof org.slug === "string" &&
    typeof org.isPersonal === "boolean" &&
    typeof org.role === "string" &&
    (org.avatarColor === undefined || org.avatarColor === null || typeof org.avatarColor === "string");
}

function isServiceCredits(value: unknown): value is LiskovServiceCredits {
  const credits = record(value);
  return credits !== undefined &&
    finiteNumber(credits.availableUsd) &&
    finiteNumber(credits.reservedUsd) &&
    finiteNumber(credits.usedUsd) &&
    finiteNumber(credits.promoUsd);
}

function isBillingTransaction(value: unknown): value is LiskovBillingTransaction {
  const transaction = record(value);
  return transaction !== undefined &&
    typeof transaction.txId === "string" &&
    typeof transaction.orgId === "string" &&
    (transaction.applicationId === undefined ||
      transaction.applicationId === null ||
      typeof transaction.applicationId === "string") &&
    typeof transaction.kind === "string" &&
    typeof transaction.asset === "string" &&
    typeof transaction.amount === "string" &&
    typeof transaction.status === "string" &&
    Number.isSafeInteger(transaction.createdAtMs);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
