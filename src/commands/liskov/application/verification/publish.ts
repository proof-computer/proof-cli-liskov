import { Flags, type Interfaces } from "@oclif/core";

import { ApplicationVerificationCommand } from "../verification.js";

export default class LiskovApplicationVerificationPublish extends ApplicationVerificationCommand {
  static description = "Publish the application's verification record or change its publisher-set label. Requires an organization admin. Without --yes, preview the change.";
  static summary = "Publish the application's public verification record.";

  static flags: Interfaces.FlagInput = {
    ...ApplicationVerificationCommand.flags,
    "clear-label": Flags.boolean({
      description: "Remove the label from the public record.",
      exclusive: ["label"]
    }),
    label: Flags.string({
      description: "Set the label shown on the public record. Omit both label flags to keep the current label."
    }),
    yes: Flags.boolean({ char: "y", description: "Confirm publication or the label change." })
  };

  protected readonly action = "publish";
}
