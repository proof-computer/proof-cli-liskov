import { formatJobProvenance, JOB_KEY_REUSE } from "./job-provenance.js";
import { asObject, policyExecutionsPath } from "./policy-explanation.js";

export async function readExecutionPage(
  applicationId: string,
  read: (path: string) => Promise<unknown>
): Promise<Record<string, unknown> | null> {
  const body = asObject(await read(policyExecutionsPath(applicationId)));
  return asObject(body?.executions) ?? null;
}

export function formatExecutionPage(page: Record<string, unknown> | null): string[] {
  if (page === null || (page.refusal !== null && page.refusal !== undefined)) return [];

  const lines: string[] = [];
  const attempts: unknown[] = Array.isArray(page.attempts) ? page.attempts : [];
  for (const attempt of attempts) {
    const effects = asObject(attempt)?.effects;
    if (!Array.isArray(effects)) continue;
    for (const value of effects as unknown[]) {
      const effect = asObject(value);
      if (effect?.effectKind !== "provider_deploy") continue;
      const block = formatJobProvenance(effect.provenance);
      if (block.length > 0) lines.push("", ...block);
    }
  }

  if (lines.length > 0) lines.push("", JOB_KEY_REUSE);
  if (typeof page.nextCursor === "string") {
    lines.push("more jobs exist than this page shows; read them with --json and the executions view");
  }
  return lines;
}
