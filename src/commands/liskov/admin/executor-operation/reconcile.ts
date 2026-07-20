import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayAdminExecutorOperationReconcile } from "../../../../session.js";

export default class SlipwayAdminExecutorOperationReconcile extends Command {
  static args = {
    operation_id: Args.string({ description: "Canonical executor operation id.", required: true })
  };
  static description = "Dry-run or apply guarded reconciliation of a provably unsubmitted replacement operation.";
  static examples = [
    "<%= config.bin %> liskov admin executor-operation reconcile op-123 --expect-application slipway-diagnostic --expect-kind runtime_replacement --expect-deployment dep-123 --expect-job job-123 --expect-status pending --reason \"terminalize unsubmitted replacement\" --json",
    "<%= config.bin %> liskov admin executor-operation reconcile op-123 --expect-application slipway-diagnostic --expect-kind runtime_replacement --expect-deployment dep-123 --expect-job job-123 --expect-status pending --reason \"terminalize unsubmitted replacement\" --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    "admin-token": Flags.string({ description: "Admin service token (else PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN, else session token)." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "expect-application": Flags.string({ description: "Required expected Application id.", required: true }),
    "expect-deployment": Flags.string({ description: "Required expected canonical deployment id.", required: true }),
    "expect-job": Flags.string({ description: "Required expected placeholder job id.", required: true }),
    "expect-kind": Flags.string({ description: "Required expected operation kind.", required: true }),
    "expect-status": Flags.string({ description: "Required expected current operation status.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    reason: Flags.string({ description: "Required operator reason recorded in the repair event.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Apply the repair. Without this flag the server returns a dry-run assessment." })
  };
  static summary = "Reconcile a provably unsubmitted replacement operation.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayAdminExecutorOperationReconcile);
    const code = await runSlipwayAdminExecutorOperationReconcile({
      adminToken: flags["admin-token"] as string | undefined,
      config: flags.config as string | undefined,
      expectApplication: flags["expect-application"] as string,
      expectDeployment: flags["expect-deployment"] as string,
      expectJob: flags["expect-job"] as string,
      expectKind: flags["expect-kind"] as string,
      expectStatus: flags["expect-status"] as string,
      json: flags.json as boolean | undefined,
      operationId: args.operation_id,
      reason: flags.reason as string,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
