import type {
  LiskovOrganizationBillingResponse,
  LiskovOrganizationListResponse,
  LiskovOrganizationServiceCreditsResponse,
  LiskovOrganizationTransactionsResponse,
  LiskovServiceCredits
} from "./organization-client.js";

export function formatOrganizationList(body: LiskovOrganizationListResponse): string {
  if (body.organizations.length === 0) return "No Liskov organizations found.";
  const lines = [`${body.organizations.length} Liskov organization(s):`];
  for (const org of body.organizations) {
    const personal = org.isPersonal ? ", personal" : "";
    lines.push(`- ${org.name} (${org.id}, ${org.slug}, role ${org.role}${personal})`);
  }
  return lines.join("\n");
}

export function formatOrganizationBilling(body: LiskovOrganizationBillingResponse): string {
  const plan = body.plan?.name ?? body.plan?.id ?? "unknown";
  const usage = body.usage ?? {};
  const lines = [
    `Billing for ${body.organization.name} (${body.organization.id}): plan ${plan}.`,
    formatCredits(body.serviceCredits)
  ];
  const usageParts = [
    numericPart(usage.applications, "application"),
    numericPart(usage.users, "user"),
    numericPart(usage.meteredSeats, "metered seat")
  ].filter((value): value is string => value !== undefined);
  if (usageParts.length > 0) lines.push(`Usage: ${usageParts.join(", ")}.`);
  if (typeof body.nextCharge?.totalUsd === "number") {
    lines.push(`Next charge: ${usd(body.nextCharge.totalUsd)}.`);
  }
  lines.push(`Recent transactions returned: ${body.transactions?.length ?? 0}.`);
  return lines.join("\n");
}

export function formatOrganizationServiceCredits(
  body: LiskovOrganizationServiceCreditsResponse
): string {
  return `Service Credits for ${body.organizationId}: ${formatCredits(body.serviceCredits)}`;
}

export function formatOrganizationTransactions(
  organizationId: string,
  body: LiskovOrganizationTransactionsResponse
): string {
  if (body.transactions.length === 0) {
    return `No billing transactions found for ${organizationId}.`;
  }
  const lines = [
    `${body.transactions.length} billing transaction(s) for ${organizationId}:`
  ];
  for (const transaction of body.transactions) {
    const application = transaction.applicationId ? `, app ${transaction.applicationId}` : "";
    lines.push(
      `- ${transaction.txId}: ${transaction.kind}, ${transaction.amount} ${transaction.asset}, ` +
      `${transaction.status}${application}, ${isoTime(transaction.createdAtMs)}`
    );
  }
  return lines.join("\n");
}

function formatCredits(credits: LiskovServiceCredits): string {
  return [
    `Available ${usd(credits.availableUsd)}`,
    `reserved ${usd(credits.reservedUsd)}`,
    `used ${usd(credits.usedUsd)}`,
    `promo ${usd(credits.promoUsd)}`
  ].join("; ");
}

function numericPart(value: number | undefined, label: string): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value} ${label}${value === 1 ? "" : "s"}`
    : undefined;
}

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(value);
}

function isoTime(value: number): string {
  return new Date(value).toISOString();
}
