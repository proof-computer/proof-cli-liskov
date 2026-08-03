import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayAdminDeploySubmitRecovery } from "../../../../session.js";

export default class SlipwayAdminExecutorOperationRecoverDeploySubmit extends Command {
  static args = {
    operation_id: Args.string({ description: "Canonical deploy_submit executor operation id.", required: true })
  };
  static description = "Prove and adopt one exact finalized deploy receipt without resubmitting or changing its reserve.";
  static examples = [
    "<%= config.bin %> liskov admin executor-operation recover-deploy-submit op-123 --expect-organization org-1 --expect-application uptime-prober-2 --expect-application-uid app-123 --expect-deployment dep-123 --expect-local-job job-123 --expect-execution live-execution:123 --expect-proposal proposal-123 --expect-reserve deploy-reserve:123 --expect-operation-status pending --expect-local-job-status proposed --expect-reserve-status reserved --finalized-block-number 3929512 --finalized-block-hash 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --extrinsic-index 3 --transaction-hash 0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 --reason \"adopt exact finalized deploy receipt\" --json",
    "<%= config.bin %> liskov admin executor-operation recover-deploy-submit op-123 [same exact guards] --reason \"adopt exact finalized deploy receipt\" --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    "admin-token": Flags.string({ description: "Admin service token (else PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN, else session token)." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "expect-organization": Flags.string({ description: "Required expected organization id.", required: true }),
    "expect-application": Flags.string({ description: "Required expected Application slug/id.", required: true }),
    "expect-application-uid": Flags.string({ description: "Required expected immutable Application UID.", required: true }),
    "expect-deployment": Flags.string({ description: "Required expected canonical deployment id.", required: true }),
    "expect-local-job": Flags.string({ description: "Required expected local job id.", required: true }),
    "expect-execution": Flags.string({ description: "Required expected live-custody execution id.", required: true }),
    "expect-proposal": Flags.string({ description: "Required expected deploy proposal id.", required: true }),
    "expect-reserve": Flags.string({ description: "Required expected deploy-spend reserve id.", required: true }),
    "expect-operation-status": Flags.string({ description: "Required expected current executor-operation status.", required: true }),
    "expect-local-job-status": Flags.string({ description: "Required expected current local-job status.", required: true }),
    "expect-reserve-status": Flags.string({ description: "Required expected current reserve status.", required: true }),
    "finalized-block-number": Flags.integer({ description: "Exact finalized Acurast block number.", min: 0, required: true }),
    "finalized-block-hash": Flags.string({ description: "Exact lowercase 0x-prefixed finalized Acurast block hash.", required: true }),
    "extrinsic-index": Flags.integer({ description: "Exact deploy extrinsic index within the finalized block.", min: 0, required: true }),
    "transaction-hash": Flags.string({ description: "Exact lowercase 0x-prefixed deploy transaction hash.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit one machine-readable JSON result and no progress text." }),
    reason: Flags.string({ description: "Required operator reason recorded with the recovery.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "After a successful exact dry run, confirm using its proof fingerprint." })
  };
  static summary = "Recover one provably finalized deploy submission.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayAdminExecutorOperationRecoverDeploySubmit);
    const code = await runSlipwayAdminDeploySubmitRecovery({
      adminToken: flags["admin-token"] as string | undefined,
      config: flags.config as string | undefined,
      expectOrganization: flags["expect-organization"] as string,
      expectApplication: flags["expect-application"] as string,
      expectApplicationUid: flags["expect-application-uid"] as string,
      expectDeployment: flags["expect-deployment"] as string,
      expectLocalJob: flags["expect-local-job"] as string,
      expectExecution: flags["expect-execution"] as string,
      expectProposal: flags["expect-proposal"] as string,
      expectReserve: flags["expect-reserve"] as string,
      expectOperationStatus: flags["expect-operation-status"] as string,
      expectLocalJobStatus: flags["expect-local-job-status"] as string,
      expectReserveStatus: flags["expect-reserve-status"] as string,
      finalizedBlockNumber: flags["finalized-block-number"] as number,
      finalizedBlockHash: flags["finalized-block-hash"] as string,
      extrinsicIndex: flags["extrinsic-index"] as number,
      transactionHash: flags["transaction-hash"] as string,
      json: flags.json as boolean | undefined,
      operationId: args.operation_id,
      reason: flags.reason as string,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
