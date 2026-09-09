export const CLI_ANALYTICS_HEADER = "x-liskov-analytics";

interface AnalyticsContext {
  enabled: boolean;
  userAgent: string;
}
let context: AnalyticsContext = { enabled: true, userAgent: "proof-cli-liskov/unknown" };

export function setCliAnalyticsContext(next: AnalyticsContext): void {
  context = next;
}

export function cliAnalyticsHeaders(): Record<string, string> {
  return context.enabled
    ? { "user-agent": context.userAgent, [CLI_ANALYTICS_HEADER]: "1" }
    : { "user-agent": context.userAgent };
}
