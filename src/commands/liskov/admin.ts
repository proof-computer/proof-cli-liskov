import { Command } from "@oclif/core";
import { AnalyticsCommand } from "../../analytics-command.js";

export default class SlipwayAdmin extends AnalyticsCommand {
  static description = "Liskov platform-admin operations.";
  static examples = [
    "<%= config.bin %> liskov admin processor list --greylisted",
    "<%= config.bin %> liskov admin executor-operation reconcile --help",
    "<%= config.bin %> liskov admin executor-operation recover-deploy-submit --help",
    "<%= config.bin %> liskov admin retirement adjudicate-lineage --help"
  ];
  static summary = "Liskov platform-admin operations.";

  async run(): Promise<void> {
    this.log("Use `proof liskov admin processor list --help`, `proof liskov admin executor-operation reconcile --help`, `proof liskov admin executor-operation recover-deploy-submit --help`, `proof liskov admin deploy-spend resolve --help`, or `proof liskov admin retirement adjudicate-lineage --help`.");
  }
}
