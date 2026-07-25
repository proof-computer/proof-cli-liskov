import { readFile, writeFile } from "node:fs/promises";

import { Command, Flags, type Interfaces } from "@oclif/core";

import { migrateApplicationPolicyV3, validateApplicationPolicyV4 } from "../../../../application-policy.js";

export default class LiskovApplicationPolicyMigrate extends Command {
  static description = "Deterministically migrate a v3 policy to a non-published v4 file.";
  static examples = [
    "<%= config.bin %> liskov application policy migrate --file policy-v3.json --output policy-v4.json",
    "<%= config.bin %> liskov application policy migrate --file policy-v3.json --output policy-v4.json --json"
  ];
  static flags: Interfaces.FlagInput = {
    file: Flags.string({ char: "f", description: "Source v3 policy JSON file.", required: true }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    output: Flags.string({ char: "o", description: "Destination v4 JSON file.", required: true })
  };
  static summary = "Migrate Application policy v3 to v4.";

  async run(): Promise<void> {
    const { flags } = await this.parse(LiskovApplicationPolicyMigrate);
    try {
      const input = JSON.parse(await readFile(flags.file as string, "utf8")) as unknown;
      const migration = migrateApplicationPolicyV3(input);
      const errors = validateApplicationPolicyV4(migration.policy);
      if (errors.some((error) => error.code === "invalid_policy" || error.code === "unknown_field")) {
        throw new Error(`migrated policy did not validate: ${errors.map((error) => `${error.pointer}: ${error.message}`).join("; ")}`);
      }
      await writeFile(flags.output as string, `${JSON.stringify(migration.policy, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      const result = {
        ok: true,
        published: false,
        output: flags.output,
        warnings: migration.warnings,
        capabilityDiagnostics: errors
      };
      if (flags.json) this.log(JSON.stringify(result));
      else {
        this.log(`Wrote v4 policy to ${flags.output as string}. Nothing was published.`);
        for (const warning of migration.warnings) this.log(`warning ${warning.pointer}: ${warning.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (flags.json) this.log(JSON.stringify({ ok: false, published: false, error: "policy_migration_failed", message }));
      else this.error(`Policy migration failed: ${message}`, { exit: 1 });
      this.exit(1);
    }
  }
}
