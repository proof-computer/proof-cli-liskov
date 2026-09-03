import { Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand, liskovUrlFlag } from "../../../organization-context.js";

import { runSlipwayApplicationRetirementCensus } from "../../../session.js";

export default class SlipwayApplicationRetirementCensus extends OrganizationScopedCommand {
  static description = [
    "Read the whole authorized retirement estate for one organization in bounded pages.",
    "",
    "Unlike `liskov application retire <ref>`, which reads one Application and refuses",
    "any Application without a repository binding, the census is organization-scoped:",
    "it describes every Application and reports coverage failures as facts rather than",
    "refusing them. Blocker facts are grouped into correlated obligations, because one",
    "unresolved obligation is otherwise reported once by the job, once by the",
    "deploy-spend reserve, and once by the billing parent.",
    "",
    "This command is read only. It starts no retirement and resolves no review."
  ].join("\n");
  static examples = [
    "<%= config.bin %> liskov application retirement-census",
    "<%= config.bin %> liskov application retirement-census --organization proof --limit 50",
    "<%= config.bin %> liskov application retirement-census --lifecycle retiring",
    "<%= config.bin %> liskov application retirement-census --remediation-class operator_adjudication",
    "<%= config.bin %> liskov application retirement-census --all",
    "<%= config.bin %> liskov application retirement-census --json"
  ];
  static flags: Interfaces.FlagInput = {
    all: Flags.boolean({
      description: "Follow every page. Cannot be combined with --json, which emits one canonical page."
    }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    cursor: Flags.string({ description: "Opaque cursor from a previous page's nextCursor." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit the canonical machine-readable retirement census response." }),
    lifecycle: Flags.string({
      description: "Report only this exact lifecycle.",
      options: ["active", "paused", "disabled", "deleted", "retiring"]
    }),
    limit: Flags.integer({ description: "Applications per page (1-100, default 25).", min: 1, max: 100 }),
    "liskov-url": liskovUrlFlag(),
    "remediation-class": Flags.string({
      description: "Report only Applications holding an obligation in this exact remediation class.",
      options: [
        "automatic_local_terminalization",
        "automatic_financial_closeout",
        "wait_for_chain_evidence",
        "evidence_backed_adjudication",
        "operator_adjudication",
        "normalize_or_adjudicate",
        "classify_or_adjudicate"
      ]
    })
  };
  static summary = "Read the bounded retirement estate census for one organization.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayApplicationRetirementCensus);
    const code = await runSlipwayApplicationRetirementCensus({
      all: flags.all as boolean | undefined,
      config: flags.config as string | undefined,
      cursor: flags.cursor as string | undefined,
      json: flags.json as boolean | undefined,
      lifecycle: flags.lifecycle as string | undefined,
      limit: flags.limit as number | undefined,
      remediationClass: flags["remediation-class"] as string | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
