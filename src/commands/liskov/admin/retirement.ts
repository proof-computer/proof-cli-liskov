import { Command } from "@oclif/core";
import { AnalyticsCommand } from "../../../analytics-command.js";

export default class SlipwayAdminRetirement extends AnalyticsCommand {
  static description = "Platform-admin retirement lineage adjudication and historical closeout.";
  static examples = [
    "<%= config.bin %> liskov admin retirement adjudicate-lineage --help",
    "<%= config.bin %> liskov admin retirement historical-closeout --help"
  ];
  static summary = "Administer retirement lineage adjudication and historical closeout.";

  async run(): Promise<void> {
    await this.config.runCommand("help", ["liskov", "admin", "retirement"]);
  }
}
