import { Flags, type Interfaces } from "@oclif/core";

import type { LiskovOrganizationSummary } from "./organization-client.js";
import { AnalyticsCommand } from "./analytics-command.js";
import { cliAnalyticsHeaders } from "./analytics-context.js";

export const LISKOV_ORGANIZATION_ENV = "LISKOV_ORGANIZATION";
export const LISKOV_URL_ENV = "LISKOV_URL";
export const LISKOV_SESSION_TOKEN_ENV = "LISKOV_SESSION_TOKEN";
export const LISKOV_SESSION_FILE_ENV = "LISKOV_SESSION_FILE";
export const LISKOV_ADMIN_SERVICE_TOKEN_ENV = "LISKOV_ADMIN_SERVICE_TOKEN";
export const MAX_ORGANIZATION_SELECTOR_BYTES = 255;

/** Preferred Liskov service URL flag. `--slipway-url` remains a compatibility alias. */
export function liskovUrlFlag(): Interfaces.OptionFlag<string | undefined> {
  return Flags.string({
    description: "Liskov service URL.",
    aliases: ["slipway-url"],
    env: LISKOV_URL_ENV
  });
}

export abstract class OrganizationScopedCommand extends AnalyticsCommand {
  static baseFlags: Interfaces.FlagInput = {
    ...AnalyticsCommand.baseFlags,
    organization: Flags.string({
      description: `Use an exact Liskov organization ID or slug for this command. Defaults to ${LISKOV_ORGANIZATION_ENV}, then the session organization.`,
      env: LISKOV_ORGANIZATION_ENV,
      helpLabel: "--organization <selector>"
    })
  };
}

export class OrganizationSelectorError extends Error {
  readonly code: "LISKOV_ORGANIZATION_SELECTOR_INVALID" | "LISKOV_ORGANIZATION_SELECTOR_REQUIRED";

  constructor(
    code: "LISKOV_ORGANIZATION_SELECTOR_INVALID" | "LISKOV_ORGANIZATION_SELECTOR_REQUIRED",
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

export function organizationSelector(
  value: string | undefined,
  options: { required?: boolean } = {}
): string | undefined {
  if (value === undefined) {
    if (options.required) {
      throw new OrganizationSelectorError(
        "LISKOV_ORGANIZATION_SELECTOR_REQUIRED",
        "Provide an organization selector as an argument, with --organization, or through LISKOV_ORGANIZATION."
      );
    }
    return undefined;
  }
  const selector = value.trim();
  if (selector.length === 0 || Buffer.byteLength(selector, "utf8") > MAX_ORGANIZATION_SELECTOR_BYTES) {
    throw new OrganizationSelectorError(
      "LISKOV_ORGANIZATION_SELECTOR_INVALID",
      `Organization selectors must contain 1–${MAX_ORGANIZATION_SELECTOR_BYTES} UTF-8 bytes after trimming.`
    );
  }
  return selector;
}

export function organizationRequestHeaders(
  sessionToken: string,
  selectorValue: string | undefined
): Record<string, string> {
  const selector = organizationSelector(selectorValue);
  return selector === undefined
    ? {
        ...cliAnalyticsHeaders(),
        accept: "application/json",
        authorization: `Bearer ${sessionToken}`
      }
    : {
        ...cliAnalyticsHeaders(),
        accept: "application/json",
        authorization: `Liskov-Organization ${sessionToken}`,
        "x-liskov-organization": selector
      };
}

export function canonicalOrganizationId(
  selectorValue: string,
  organizations: readonly LiskovOrganizationSummary[]
): string | undefined {
  const selector = organizationSelector(selectorValue, { required: true })!;
  return organizations.find((organization) => organization.id === selector)?.id ??
    organizations.find((organization) => organization.slug === selector)?.id;
}

/**
 * The `not_a_member` refusal for a selector that names no membership. Selection
 * stays exact (ADR-0047); when the selector is exactly one membership's display
 * name, the refusal says which slug and ID to use instead of guessing.
 */
export function organizationSelectorRefusal(
  selectorValue: string,
  organizations: readonly LiskovOrganizationSummary[]
): { body: Record<string, unknown>; message: string } {
  const selector = organizationSelector(selectorValue, { required: true })!;
  const named = organizations.filter((organization) => organization.name === selector);
  const base = `Error (not_a_member): no active organization membership exactly matches ${selector}.`;
  if (named.length !== 1) return { body: { ok: false, error: "not_a_member", selector }, message: base };
  const [organization] = named;
  return {
    body: { ok: false, error: "not_a_member", selector, suggestion: { slug: organization.slug, organizationId: organization.id } },
    message: `${base} "${selector}" is the display name of ${organization.slug} (${organization.id}); select it by slug or ID.`
  };
}
