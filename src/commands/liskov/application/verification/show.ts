import { ApplicationVerificationCommand } from "../verification.js";

export default class LiskovApplicationVerificationShow extends ApplicationVerificationCommand {
  static description = "Show the application's public verification record. Requires an organization admin to publish or unpublish.";
  static summary = "Show the application's public verification record.";

  protected readonly action = "show";
}
