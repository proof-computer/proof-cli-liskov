import { Command } from "@oclif/core";

export default class SlipwayAdminRetirement extends Command {
  static description = "Platform-admin retirement lineage operations.";
  static examples = [
    "<%= config.bin %> liskov admin retirement adjudicate-lineage --help"
  ];
  static summary = "Administer retirement lineage adjudication.";

  async run(): Promise<void> {
    await this.config.runCommand("help", ["liskov", "admin", "retirement"]);
  }
}
