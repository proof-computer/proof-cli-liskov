# Agent Instructions

This private package owns the Slipway plugin for the root `proof` CLI.

- Keep this package private until Slipway is intentionally exposed.
- User-facing `proof slipway ...` work belongs here as native oclif plugin
  behavior. Do not add legacy non-oclif adapters as proof command
  implementation paths.
- Keep builder-facing login separate from private operator recovery:
  `proof slipway login` is the browser-confirmed GitHub/device-style path,
  while `slipway:ops login` remains sr25519 operator/admin recovery.
- Keep local session files and command output secret-safe. Bearer tokens must
  not appear in URLs, logs, JSON output, human output, errors, or debug text.
- Keep package verification focused on the npm/plugin surface: `dist`,
  `oclif.manifest.json`, and `README.md`.

## CLI Development Guidance

When changing CLI behavior, review Liran Tal's Node.js CLI Apps Best
Practices and its agent-oriented skill:

- https://github.com/lirantal/nodejs-cli-apps-best-practices
- https://github.com/lirantal/nodejs-cli-apps-best-practices/tree/main/skills/nodejs-cli-best-practices

Use it as a checklist for POSIX-style flags, structured output,
configuration precedence, actionable errors, debug output, exit codes, version
output, package `files`, strict opt-in analytics, and argument-injection
safety. Slipway's GitHub identity, custody, and secret-handling rules remain
stricter where they apply.
