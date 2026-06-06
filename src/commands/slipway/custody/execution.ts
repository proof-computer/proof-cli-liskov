import { Command } from "@oclif/core";

export default class SlipwayCustodyExecution extends Command {
  static description = "Manage Slipway live custody executions.";
  static summary = "Manage Slipway live custody executions.";

  async run(): Promise<void> {
    this.log("Use `proof slipway custody execution --help` to list execution commands.");
  }
}
