import { formatExecutionPage, readExecutionPage } from "./execution-page.js";
import {
  applicationCoveragePath,
  applicationStoppedFrom,
  coverageScheduleFrom,
  formatExecutionExplanation,
  formatIntervalSchedule,
  readIntervalSchedule
} from "./execution-explanation.js";
import type { PolicyExplanation } from "./policy-explanation.js";

export async function readExecutionSnapshot(
  applicationId: string,
  explanation: PolicyExplanation,
  read: (path: string) => Promise<unknown>
) {
  // Only an interval schedule can promise a next run, so only it needs to
  // know if the application was stopped.
  const coverage = coverageScheduleFrom(await read(applicationCoveragePath(applicationId)));
  const stopped = coverage?.schedule?.mode === "interval"
    ? applicationStoppedFrom(await read(`/api/applications/${encodeURIComponent(applicationId)}`))
    : undefined;
  const scheduleLine = coverage === undefined
    ? undefined
    : formatIntervalSchedule(
      readIntervalSchedule(coverage.schedule, { readAtMs: coverage.readAtMs, stopped: stopped === true, serving: coverage.serving }),
      { typed: coverage.typed, stoppedKnown: stopped !== undefined }
    );

  const executions = await readExecutionPage(applicationId, read);
  return {
    schedule: coverage?.schedule ?? null,
    executions,
    human: () => [
      formatExecutionExplanation(explanation),
      scheduleLine,
      ...formatExecutionPage(executions)
    ].filter((line): line is string => line !== undefined).join("\n")
  };
}
