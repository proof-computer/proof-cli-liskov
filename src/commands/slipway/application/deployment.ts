import { Command } from "@oclif/core";

export default class SlipwayApplicationDeployment extends Command {
  static description = "Manage Slipway Application deployment imports.";
  static examples = [
    "<%= config.bin %> slipway application deployment import proof-docs --sequence 701 --origin 5..."
  ];
  static summary = "Manage Slipway Application deployment imports.";

  async run(): Promise<void> {
    this.log("Use `proof slipway application deployment import --help`.");
  }
}
