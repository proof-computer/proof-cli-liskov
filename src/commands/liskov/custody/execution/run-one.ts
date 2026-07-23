import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayCustodyExecutionRunOne } from "../../../../session.js";

export default class SlipwayCustodyExecutionRunOne extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Run exactly one guarded server-owned live custody transition. Submit mode freshly preflights the selected plan and requires both values copied from one custodial.live item.";
  static examples = [
    "<%= config.bin %> liskov custody execution run-one proof-docs --execution-id live-execution:abc --expect-kind acurast.deploy --expect-policy-digest sha256:abc --expect-deployment-id 75824 --yes --json",
    "<%= config.bin %> liskov custody preflight proof-docs --json",
    "<%= config.bin %> liskov custody execution run-one proof-docs --plan-item-id PLAN_ITEM_ID_FROM_ONE_ITEM --idempotency-key OPAQUE_KEY_FROM_SAME_ITEM --expect-kind acurast.deploy --expect-policy-digest sha256:abc --require-environment-bootstrap --require-one-generation --yes --yes-spend"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "execution-id": Flags.string({ description: "Existing execution id to observe." }),
    "expect-deployment-id": Flags.string({ description: "Require the selected execution or plan to match this Acurast deployment id." }),
    "expect-kind": Flags.string({ description: "Require this live custody action kind.", required: true }),
    "expect-policy-digest": Flags.string({ description: "Require this active policy digest.", required: true }),
    help: Flags.help({ char: "h" }),
    "idempotency-key": Flags.string({ description: "Opaque idempotencyKey copied unchanged from the same preflight --json item as --plan-item-id; never generate one." }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    network: Flags.string({ description: "Acurast network for optional environment handoff.", options: ["mainnet", "testnet", "canary"] }),
    "plan-item-id": Flags.string({ description: "planItemId copied from one custodial.live preflight --json item together with its idempotencyKey." }),
    "require-environment-bootstrap": Flags.boolean({ description: "Require preflight proof that a server-delivered environment and setEnvironment bootstrap are enabled." }),
    "require-one-generation": Flags.boolean({ description: "Require preflight proof that runtime.maxGenerations is exactly 1." }),
    "repo-dir": Flags.string({ description: "Repository directory for future local action providers." }),
    "rpc-url": Flags.string({ description: "Acurast RPC URL for optional environment handoff." }),
    "secrets-file": Flags.string({ description: "Local dotenv file for acurast.setEnvironment submit mode." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm running one guarded server-owned transition." }),
    "yes-spend": Flags.boolean({ description: "Confirm live custody spend for submit mode." })
  };
  static summary = "Run one guarded live custody transition.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayCustodyExecutionRunOne);
    const code = await runSlipwayCustodyExecutionRunOne({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      executionId: flags["execution-id"] as string | undefined,
      expectDeploymentId: flags["expect-deployment-id"] as string | undefined,
      expectKind: flags["expect-kind"] as string,
      expectPolicyDigest: flags["expect-policy-digest"] as string,
      idempotencyKey: flags["idempotency-key"] as string | undefined,
      json: flags.json as boolean | undefined,
      network: flags.network as never,
      planItemId: flags["plan-item-id"] as string | undefined,
      requireEnvironmentBootstrap: flags["require-environment-bootstrap"] as boolean | undefined,
      requireOneGeneration: flags["require-one-generation"] as boolean | undefined,
      repoDir: flags["repo-dir"] as string | undefined,
      rpcUrl: flags["rpc-url"] as string | undefined,
      secretsFile: flags["secrets-file"] as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined,
      yesSpend: flags["yes-spend"] as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
