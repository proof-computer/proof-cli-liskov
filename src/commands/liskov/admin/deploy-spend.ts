import { Command } from "@oclif/core";

export default class SlipwayAdminDeploySpend extends Command {
  static description = "Resolve held Liskov deploy-spend billing reviews.";
  static summary = "Administer deploy-spend review holds.";

  async run(): Promise<void> {
    await this.config.runCommand("help", ["liskov", "admin", "deploy-spend"]);
  }
}
