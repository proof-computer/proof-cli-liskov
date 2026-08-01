import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runRuntimeSshConnection } from "../../runtime-ssh.js";

export default class LiskovSsh extends Command {
  static args = { app: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }) };
  static description = "Connect to an exact ready runtime through your existing Tailscale login.";
  static examples = [
    "<%= config.bin %> liskov ssh my-app",
    "<%= config.bin %> liskov ssh my-app --deployment deploy_123 --print-command",
    "<%= config.bin %> liskov ssh my-app --job job_123"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    deployment: Flags.string({ description: "Select an exact deployment id." }),
    help: Flags.help({ char: "h" }),
    job: Flags.string({ description: "Select an exact job id." }),
    json: Flags.boolean({ description: "Emit machine-readable JSON (most useful with --print-command)." }),
    "print-command": Flags.boolean({ description: "Resolve and verify the connection without opening SSH." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Open BYO Tailscale SSH to a Liskov runtime.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovSsh);
    const code = await runRuntimeSshConnection({
      applicationRef: args.app,
      deploymentId: flags.deployment as string | undefined,
      jobId: flags.job as string | undefined,
      printCommand: flags["print-command"] as boolean | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
