import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationDeploymentImport } from "../../../../session.js";

export default class SlipwayApplicationDeploymentImport extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Import an existing Acurast deployment into a Liskov Application.";
  static examples = [
    "<%= config.bin %> liskov application deployment import proof-docs --sequence 701 --origin 5abc... --yes",
    "<%= config.bin %> liskov application deployment import proof-docs --sequence 701 --origin 5abc... --replica-index 0 --json --yes"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "deployment-id": Flags.string({ description: "Existing Acurast deployment id." }),
    "endpoint-hostname": Flags.string({ description: "Endpoint hostname to attach to the imported child." }),
    "gateway-id": Flags.string({ description: "Gateway id to attach to the imported child." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    origin: Flags.string({ description: "Acurast launch account address for the imported job.", required: true }),
    processor: Flags.string({ description: "Expected processor id for the imported job." }),
    "replica-index": Flags.integer({ description: "Replica index for the imported child." }),
    sequence: Flags.integer({ description: "Acurast job/deployment sequence.", required: true }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the deployment import mutation." })
  };
  static summary = "Import an existing Acurast deployment.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationDeploymentImport);
    const code = await runSlipwayApplicationDeploymentImport({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      deploymentId: flags["deployment-id"] as string | undefined,
      endpointHostname: flags["endpoint-hostname"] as string | undefined,
      gatewayId: flags["gateway-id"] as string | undefined,
      json: flags.json as boolean | undefined,
      origin: flags.origin as string,
      processor: flags.processor as string | undefined,
      replicaIndex: flags["replica-index"] as number | undefined,
      sequence: flags.sequence as number,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
