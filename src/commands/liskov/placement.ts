import { OrganizationScopedCommand } from "../../organization-context.js";

export default class SlipwayPlacement extends OrganizationScopedCommand {
  static description = "Read what a Liskov placement rule would reach.";
  static summary = "Read what a Liskov placement rule would reach.";

  async run(): Promise<void> {
    this.log("Use `proof liskov placement --help` to list placement commands.");
  }
}
