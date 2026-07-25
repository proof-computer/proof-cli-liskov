import { readFile } from "node:fs/promises";

import { Command, Flags, type Interfaces } from "@oclif/core";

import { validateApplicationPolicyV4 } from "../../../../application-policy.js";

export default class LiskovApplicationPolicyValidate extends Command {
  static description = "Strictly validate an Application policy v4 file without publishing it.";
  static examples = [
    "<%= config.bin %> liskov application policy validate --file .liskov/application-policy.json",
    "<%= config.bin %> liskov application policy validate --file policy.json --json"
  ];
  static flags: Interfaces.FlagInput = {
    file: Flags.string({ char: "f", description: "Application policy JSON file.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." })
  };
  static summary = "Validate Application policy v4.";

  async run(): Promise<void> {
    const { flags } = await this.parse(LiskovApplicationPolicyValidate);
    let policy: unknown;
    try {
      policy = JSON.parse(await readFile(flags.file as string, "utf8")) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (flags.json) this.log(JSON.stringify({ ok: false, valid: false, error: "invalid_policy_file", message }));
      else this.error(`Unable to read policy: ${message}`, { exit: 1 });
      this.exit(1);
    }
    const errors = validateApplicationPolicyV4(policy);
    const result = { ok: errors.length === 0, valid: errors.length === 0, errors };
    if (flags.json) this.log(JSON.stringify(result));
    else if (errors.length === 0) this.log("Application policy v4 is valid and enabled by the first-public capability set.");
    else {
      for (const error of errors) this.log(`${error.code} ${error.pointer || "/"}: ${error.message}`);
    }
    if (errors.length > 0) this.exit(1);
  }
}
