import { Command, Flags, type Interfaces } from "@oclif/core";

import { setCliAnalyticsContext } from "./analytics-context.js";

interface AnalyticsSession {
  sessionToken: string;
  slipwayUrl: string;
}

export async function sendCliInvocation(
  saved: AnalyticsSession,
  commandId: string,
  userAgent: string,
  exitClass: "success" | "failure",
  fetcher: typeof fetch = fetch
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 250);
  try {
    await fetcher(new URL("/api/telemetry/cli-invocation", saved.slipwayUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${saved.sessionToken}`,
        "content-type": "application/json",
        "user-agent": userAgent,
        "x-liskov-analytics": "1"
      },
      body: JSON.stringify({
        commandId,
        cliVersion: userAgent.slice("proof-cli-liskov/".length),
        exitClass
      })
    });
  } catch {
    // Product analytics can never change command output or exit status.
  } finally {
    clearTimeout(timeout);
  }
}

export abstract class AnalyticsCommand extends Command {
  static baseFlags: Interfaces.FlagInput = {
    "no-analytics": Flags.boolean({
      description: "Do not report this command invocation to Liskov product analytics.",
      helpGroup: "GLOBAL"
    })
  };

  private analyticsDisabled = false;
  private analyticsSavedSession: AnalyticsSession | undefined;
  private analyticsSessionFile = "";
  private analyticsUserAgent = "proof-cli-liskov/unknown";

  public async init(): Promise<void> {
    await super.init();
    const parsed = await this.parse({
      args: this.ctor.args,
      flags: this.ctor.flags,
      baseFlags: this.ctor.baseFlags,
      strict: this.ctor.strict
    });
    const flags = parsed.flags as Record<string, unknown>;
    this.analyticsDisabled = flags["no-analytics"] === true;
    const pluginVersion = this.ctor.plugin?.version ?? this.config.version ?? "unknown";
    this.analyticsUserAgent = `proof-cli-liskov/${pluginVersion}`;
    try {
      const { resolveSlipwaySessionFile } = await import("./session.js");
      this.analyticsSessionFile = resolveSlipwaySessionFile({
        config: typeof flags.config === "string" ? flags.config : undefined,
        env: process.env
      });
      const { readSlipwaySession } = await import("./session.js");
      this.analyticsSavedSession = await readSlipwaySession(this.analyticsSessionFile).catch(() => undefined);
    } catch {
      this.analyticsSessionFile = "";
    }
    setCliAnalyticsContext({
      enabled: !this.analyticsDisabled,
      userAgent: this.analyticsUserAgent
    });
  }

  protected async finally(error: Error | undefined): Promise<void> {
    try {
      if (!this.analyticsDisabled && this.id?.startsWith("liskov") && this.analyticsSessionFile) {
        const { readSlipwaySession } = await import("./session.js");
        const saved = this.analyticsSavedSession
          ?? await readSlipwaySession(this.analyticsSessionFile).catch(() => undefined);
        if (saved) {
          await sendCliInvocation(
            saved,
            this.id,
            this.analyticsUserAgent,
            error ? "failure" : "success"
          );
        }
      }
    } finally {
      await super.finally(error);
    }
  }
}
