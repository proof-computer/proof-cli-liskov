import { Command } from "@oclif/core";
import { AnalyticsCommand } from "../../../analytics-command.js";

export default class SlipwayAdminExecutorOperation extends AnalyticsCommand {
  static description = "Guarded Liskov executor-operation repair commands.";
  static summary = "Guarded executor-operation repair commands.";

  async run(): Promise<void> {
    this.log("Use `proof liskov admin executor-operation reconcile --help` or `proof liskov admin executor-operation recover-deploy-submit --help`.");
  }
}
