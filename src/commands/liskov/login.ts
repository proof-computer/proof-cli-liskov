import { Command, Flags, type Interfaces } from "@oclif/core";

import { LISKOV_SESSION_TOKEN_ENV, liskovUrlFlag } from "../../organization-context.js";
import { runSlipwayLogin } from "../../session.js";

export default class SlipwayLogin extends Command {
  static description = "Start browser-confirmed Liskov CLI login.";
  static examples = [
    "<%= config.bin %> liskov login",
    "<%= config.bin %> liskov login --no-browser",
    "<%= config.bin %> liskov login --liskov-url https://console.liskov.proof.computer --json",
    "<%= config.bin %> liskov login --session-token TOKEN --liskov-url http://127.0.0.1:8787"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "no-browser": Flags.boolean({ description: "Print the verification URL instead of opening a browser." }),
    "poll-interval-ms": Flags.integer({ description: "Override the CLI login poll interval in milliseconds." }),
    "timeout-ms": Flags.integer({ description: "Stop waiting for browser authorization after this many milliseconds." }),
    "liskov-url": liskovUrlFlag(),
    "session-token": Flags.string({
      description: "Use an already-minted session token instead of the GitHub device flow.",
      env: LISKOV_SESSION_TOKEN_ENV
    })
  };
  static summary = "Start Liskov CLI login.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayLogin);
    const code = await runSlipwayLogin({
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      liskovUrl: flags["liskov-url"] as string | undefined,
      noBrowser: flags["no-browser"] as boolean | undefined,
      pollIntervalMs: flags["poll-interval-ms"] as number | undefined,
      sessionToken: flags["session-token"] as string | undefined,
      timeoutMs: flags["timeout-ms"] as number | undefined
    }, {
      stderr: (line) => process.stderr.write(`${line}\n`),
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
