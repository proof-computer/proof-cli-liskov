import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class SlipwayApplicationDeployment extends OrganizationScopedCommand {
  static description = "Manage Liskov Application deployment imports.";
  static examples = [
    "<%= config.bin %> liskov application deployment import proof-docs --sequence 701 --origin 5..."
  ];
  static summary = "Manage Liskov Application deployment imports.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application deployment import --help`.");
  }
}
