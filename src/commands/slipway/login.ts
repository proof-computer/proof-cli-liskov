import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayLogin } from "../../session.js";

export default class SlipwayLogin extends Command {
  static description = "Start browser-confirmed Slipway CLI login.";
  static examples = [
    "<%= config.bin %> slipway login",
    "<%= config.bin %> slipway login --no-browser",
    "<%= config.bin %> slipway login --slipway-url https://slipway.proof.computer --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Slipway session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "no-browser": Flags.boolean({ description: "Print the verification URL instead of opening a browser." }),
    "poll-interval-ms": Flags.integer({ description: "Override the CLI login poll interval in milliseconds." }),
    "timeout-ms": Flags.integer({ description: "Stop waiting for browser authorization after this many milliseconds." }),
    "slipway-url": Flags.string({ description: "Slipway service URL." })
  };
  static summary = "Start Slipway CLI login.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayLogin);
    const code = await runSlipwayLogin({
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      noBrowser: flags["no-browser"] as boolean | undefined,
      pollIntervalMs: flags["poll-interval-ms"] as number | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      timeoutMs: flags["timeout-ms"] as number | undefined
    }, {
      stderr: (line) => process.stderr.write(`${line}\n`),
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
