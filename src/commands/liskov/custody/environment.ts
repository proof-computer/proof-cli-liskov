import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class SlipwayCustodyEnvironment extends OrganizationScopedCommand {
  static description = "Manage encrypted live custody environment handoffs.";
  static summary = "Manage encrypted live custody environment handoffs.";

  async run(): Promise<void> {
    this.log("Use `proof liskov custody environment upload --help`.");
  }
}
