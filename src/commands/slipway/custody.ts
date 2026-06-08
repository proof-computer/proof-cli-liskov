import { Command } from "@oclif/core";

export default class SlipwayCustody extends Command {
  static description = "Operate Slipway live custody for internal Applications.";
  static strict = false;
  static examples = [
    "<%= config.bin %> slipway custody preflight proof-docs",
    "<%= config.bin %> slipway custody execution list proof-docs"
  ];
  static summary = "Operate Slipway live custody.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayCustodyHelp(this.config.bin);
      return;
    }
    console.error(
      `[slipway] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof slipway custody command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} slipway custody --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayCustodyHelp(bin: string): void {
  console.log(`Slipway live custody commands.

USAGE
  $ ${bin} slipway custody <command> [options]

COMMANDS
  account ensure APP_REF --chain acurast --yes
  preflight APP_REF
  environment upload APP_REF --secrets-file PATH --yes
  execution list APP_REF
  execution run-one APP_REF --execution-id ID --expect-kind KIND --expect-policy-digest DIGEST --yes
  execution run-one APP_REF --plan-item-id ID --idempotency-key KEY --expect-kind KIND --expect-policy-digest DIGEST --yes-spend --yes
  execution submit APP_REF --plan-item-id ID --idempotency-key KEY --yes-spend --yes
  execution observe APP_REF --execution-id ID
  execution diagnose APP_REF --execution-id ID
  execution recover APP_REF --execution-id ID --reason TEXT --yes
  child recover APP_REF --child-session-id ID --reason TEXT --yes
  machine catalog

DESCRIPTION
  Live custody commands use the local proof slipway session created by
  \`${bin} slipway login\`. Execution submit requires both --yes and
  --yes-spend.`);
}
