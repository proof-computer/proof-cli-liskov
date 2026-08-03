import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class SlipwayCustodyExecution extends OrganizationScopedCommand {
  static description = "Manage Liskov live custody executions.";
  static summary = "Manage Liskov live custody executions.";

  async run(): Promise<void> {
    this.log("Use `proof liskov custody execution --help` to list execution commands.");
  }
}
