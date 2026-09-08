import { Command } from "@oclif/core";
import { AnalyticsCommand } from "../../../analytics-command.js";

export default class SlipwayAdminRetirement extends AnalyticsCommand {
  static description = "Platform-admin retirement lineage operations.";
  static examples = [
    "<%= config.bin %> liskov admin retirement adjudicate-lineage --help"
  ];
  static summary = "Administer retirement lineage adjudication.";

  async run(): Promise<void> {
    await this.config.runCommand("help", ["liskov", "admin", "retirement"]);
  }
}
