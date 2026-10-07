import { Args, Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../organization-context.js";

import { runRuntimeSshConnection, type RuntimeSshForwardDirective } from "../../runtime-ssh.js";

/**
 * oclif preserves order inside one repeatable flag, not across `-L`, `-D`, and
 * `-N`. OpenSSH applies that interleaved order, so read it from argv after
 * parse has accepted the flags. `-R`, `-o`, and `--` are not flags here.
 */
export function sshForwardDirectivesFromArgv(argv: readonly string[]): RuntimeSshForwardDirective[] {
  const directives: RuntimeSshForwardDirective[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") break;
    if (token === "-N" || token === "--no-remote-command") {
      directives.push({ kind: "N" });
      continue;
    }
    const inline = /^-([LD])([\s\S]+)$/u.exec(token);
    if (inline?.[1] === "L" || inline?.[1] === "D") {
      directives.push({ kind: inline[1], spec: inline[2] ?? "" });
      continue;
    }
    const equals = /^--(local-forward|dynamic-forward)=([\s\S]*)$/u.exec(token);
    if (equals?.[1] === "local-forward" || equals?.[1] === "dynamic-forward") {
      directives.push({ kind: equals[1] === "local-forward" ? "L" : "D", spec: equals[2] ?? "" });
      continue;
    }
    if (token === "-L" || token === "--local-forward" || token === "-D" || token === "--dynamic-forward") {
      const spec = argv[index + 1];
      if (spec === undefined) continue;
      directives.push({ kind: token === "-L" || token === "--local-forward" ? "L" : "D", spec });
      index += 1;
    }
  }
  return directives;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return [];
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export default class LiskovSsh extends OrganizationScopedCommand {
  static args = { app: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }) };
  static description = "Connect to an exact ready runtime through its declared Runtime SSH provider. Managed sessions pass repeatable -L and -D through to OpenSSH, and -N requests no remote command. -R is not accepted.";
  static examples = [
    "<%= config.bin %> liskov ssh my-app",
    "<%= config.bin %> liskov ssh my-app --deployment deploy_123 --print-command",
    "<%= config.bin %> liskov ssh my-app --job job_123",
    "<%= config.bin %> liskov ssh my-app --job 155468",
    "<%= config.bin %> liskov ssh my-app --key work-laptop",
    "<%= config.bin %> liskov ssh my-app -L 127.0.0.1:9222:127.0.0.1:9222 -L 8080:example.com:80 -D 1080 -N"
  ];
  static flags: Interfaces.FlagInput = {
    "accept-host-key": Flags.boolean({ description: "Accept and pin a first-use managed runtime host key without prompting." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    deployment: Flags.string({ description: "Select an exact deployment id." }),
    "dynamic-forward": Flags.string({
      char: "D",
      description: "Dynamic SOCKS forward passed through to OpenSSH as -D [bind:]port. Repeatable. Any bind address is accepted.",
      multiple: true
    }),
    help: Flags.help({ char: "h" }),
    identity: Flags.string({ description: "Ed25519 private-key path. Defaults to an authorized local key in ~/.ssh; with --key, must match that named key." }),
    key: Flags.string({ description: "Select an exact organization operator-key name and find its matching local private key." }),
    job: Flags.string({ description: "Select an exact job id, or a provider job sequence (a V5 job\u2019s number)." }),
    json: Flags.boolean({ description: "Emit machine-readable JSON (most useful with --print-command)." }),
    "local-forward": Flags.string({
      char: "L",
      description: "Local forward passed through to OpenSSH as -L [bind:]port:host:hostport. Repeatable. Any destination host is accepted.",
      multiple: true
    }),
    "no-remote-command": Flags.boolean({
      char: "N",
      description: "Request no remote command (OpenSSH -N)."
    }),
    "print-command": Flags.boolean({ description: "Resolve and verify the connection without opening SSH." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Open SSH to a Liskov runtime through Tailscale or managed access.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovSsh);
    const forwards = sshForwardDirectivesFromArgv(this.argv);
    const local = stringList(flags["local-forward"]);
    const dynamic = stringList(flags["dynamic-forward"]);
    const noRemoteCommand = flags["no-remote-command"] === true;
    const parsedLocal = forwards.flatMap((item) => item.kind === "L" ? [item.spec] : []);
    const parsedDynamic = forwards.flatMap((item) => item.kind === "D" ? [item.spec] : []);
    if (!sameSequence(parsedLocal, local) || !sameSequence(parsedDynamic, dynamic) || forwards.some((item) => item.kind === "N") !== noRemoteCommand) {
      this.error("Could not keep -L and -D in the order they were written. Pass each forward as its own -L or -D argument.", { exit: 2 });
    }
    const code = await runRuntimeSshConnection({
      applicationRef: args.app,
      acceptHostKey: flags["accept-host-key"] as boolean | undefined,
      cliBin: this.config.bin,
      deploymentId: flags.deployment as string | undefined,
      jobId: flags.job as string | undefined,
      identity: flags.identity as string | undefined,
      key: flags.key as string | undefined,
      printCommand: flags["print-command"] as boolean | undefined,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      forwards
    }, { organization: flags.organization as string | undefined, stdout: (line) => this.log(line), stderr: (line) => this.warn(line) });
    if (code !== 0) this.exit(code);
  }
}
