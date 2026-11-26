import { Flags, type Interfaces } from "@oclif/core";

import { ApplicationVerificationCommand } from "../verification.js";

export default class LiskovApplicationVerificationUnpublish extends ApplicationVerificationCommand {
  static description = "Withdraw the application's public verification record. Requires an organization admin. Without --yes, preview the change.";
  static summary = "Withdraw the application's public verification record.";

  static flags: Interfaces.FlagInput = {
    ...ApplicationVerificationCommand.flags,
    yes: Flags.boolean({ char: "y", description: "Confirm withdrawal of the public record." })
  };

  protected readonly action = "unpublish";
}
