import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class SlipwayCustodySigner extends OrganizationScopedCommand {
  static hidden = true;
  static description = "Read a Liskov Application's self-custody signer.";
  static summary = "Read a Liskov Application's self-custody signer.";

  async run(): Promise<void> {
    this.log("Use `proof liskov custody signer --help` to list signer commands.");
  }
}
