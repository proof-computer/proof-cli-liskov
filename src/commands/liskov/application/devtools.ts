import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class SlipwayApplicationDevtools extends OrganizationScopedCommand {
  static description = "Inspect Liskov Applications in Acurast DevTools.";
  static examples = [
    "<%= config.bin %> liskov application devtools view-key proof-docs 66059"
  ];
  static summary = "Inspect Liskov Applications in Acurast DevTools.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application devtools view-key --help`.");
  }
}
