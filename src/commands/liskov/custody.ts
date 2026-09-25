import { Command } from "@oclif/core";
import { AnalyticsCommand } from "../../analytics-command.js";

const CUSTODY_COMMANDS = [
  "account ensure APP_REF --chain acurast --yes",
  "pair APP_REF",
  "signer status APP_REF",
  "preflight APP_REF",
  "environment upload APP_REF --secrets-file PATH --yes",
  "execution list APP_REF",
  "execution run-one APP_REF --execution-id ID --expect-kind KIND --expect-policy-digest DIGEST --yes",
  "execution run-one APP_REF --plan-item-id PREFLIGHT_ITEM_ID --idempotency-key OPAQUE_KEY_FROM_SAME_ITEM --expect-kind KIND --expect-policy-digest DIGEST --yes-spend --yes",
  "execution submit APP_REF --plan-item-id ID --idempotency-key KEY --yes-spend --yes",
  "execution observe APP_REF --execution-id ID",
  "execution diagnose APP_REF --execution-id ID",
  "execution recover APP_REF --execution-id ID --reason TEXT --yes",
  "execution retry APP_REF --execution-id ID --reason TEXT --yes",
  "machine catalog"
];

// The whole custody tree is hidden, so oclif's `--help` lists none of its
// subcommands; the description carries the list for operators instead.
export default class SlipwayCustody extends AnalyticsCommand {
  static hidden = true;
  static description = [
    "Operator-only Liskov live custody commands. They are internal operator tooling, hidden from help, and not part of the customer command surface.",
    "Commands:\n" + CUSTODY_COMMANDS.map((command) => `  <%= config.bin %> liskov custody ${command}`).join("\n")
  ].join("\n\n");
  static strict = false;
  static examples = [
    "<%= config.bin %> liskov custody preflight proof-docs",
    "<%= config.bin %> liskov custody execution list proof-docs"
  ];
  static summary = "Operator-only Liskov live custody commands.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayCustodyHelp(this.config.bin);
      return;
    }
    console.error(
      `[liskov] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof liskov custody command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} liskov custody --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayCustodyHelp(bin: string): void {
  console.log(`Operator-only Liskov live custody commands.

USAGE
  $ ${bin} liskov custody <command> [options]

COMMANDS
${CUSTODY_COMMANDS.map((command) => `  ${command}`).join("\n")}

DESCRIPTION
  Live custody commands use the local proof liskov session created by
  \`${bin} liskov login\`. Execution submit requires both --yes and
  --yes-spend. For run-one submit, copy planItemId and the opaque
  idempotencyKey from the same custodial.live preflight --json item.`);
}
