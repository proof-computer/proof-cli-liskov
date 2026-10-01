import { OrganizationScopedCommand } from "../../organization-context.js";

// Hidden until V6 is released: `BKLG-20260907-ie6x` un-hides and documents it.
export default class SlipwayPlacement extends OrganizationScopedCommand {
  static hidden = true;
  static description = "Read what a Liskov placement rule would reach.";
  static summary = "Read what a Liskov placement rule would reach.";

  async run(): Promise<void> {
    this.log("Use `proof liskov placement --help` to list placement commands.");
  }
}
