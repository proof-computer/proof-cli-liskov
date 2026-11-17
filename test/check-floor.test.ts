import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkFloor, readHistoryBaseline } from "../scripts/check-floor.mjs";

const baseline = (overrides = {}) => ({
  anonymous_markers: 0,
  eslint_suppressions: 0,
  held_files: {},
  reason: "BKLG-20261108-fwlp: pre-existing lint findings, counted rather than converted",
  held_reason: "BKLG-20261108-fwlp: pre-existing oversized files, held rather than split",
  ...overrides
});
const check = (text: string, file = "src/example.ts", overrides = {}) => checkFloor({ files: { [file]: text }, baseline: baseline(overrides) });
const accepted = (text: string, file?: string, overrides = {}) => assert.deepEqual(check(text, file, overrides).errors, []);
const refused = (text: string, file = "src/example.ts", overrides = {}) => {
  const result = check(text, file, overrides);
  assert.ok(result.errors.some((error: string) => error.startsWith(`${file}:`)), JSON.stringify(result));
  return result;
};
const lines = (count: number) => "\n".repeat(count);

// Each fixture crosses the same policy interface as the command, including its baseline.
test("bare TODO is refused with its file and line", () => {
  const result = refused("const n = 0;\n// TODO tidy\n");
  assert.ok(result.errors.includes("src/example.ts:2: anonymous deferral"));
});

test("TODO with BKLG id and FIXME below EPIC id are accepted", () => {
  accepted("// TODO(BKLG-20261108-abcd): tidy\n// EPIC-20261108-nmft\n// FIXME tidy\n");
  accepted("/*\n * Q-20261108-abcd\n * HACK: tidy\n */");
});

test("strings, templates and regular expressions are not markers", () => {
  accepted('const s = "TODO"; const t = `// TODO\n// eslint-disable`; const r = /TODO/;');
  accepted('const t = `prefix ${1} // TODO\n/* HACK */`; const r = /https?:\\/\\/TODO/;');
  accepted('const s = "{ skip: true } test.skip( // eslint-disable";');
});

test("block deferrals, empty-block and end-of-file comments are found", () => {
  refused("/*\n * XXX tidy\n */");
  refused("function f() {\n// HACK\n}");
  refused("const n = 1; // FIXME");
  accepted("// TODOING is not a deferral\n/* some TODO prose */");
});

test("bare ESLint directive is refused and description syntax is accepted", () => {
  refused("// eslint-disable-next-line no-console\nconsole.log(1);");
  accepted("// eslint-disable-next-line no-console -- the CLI prints here\nconsole.log(1);");
});

test("bare ts-expect-error is refused and a description is accepted", () => {
  refused("// @ts-expect-error\nconst x = 1;");
  accepted("// @ts-expect-error upstream types omit this property\nconst x = 1;");
});

test("all directive forms require a ledger id or their permitted reason", () => {
  for (const directive of ["eslint-disable", "eslint-disable-line", "prettier-ignore", "c8 ignore next", "istanbul ignore next"]) {
    refused(`// ${directive}\nconst x = 1;`);
    accepted(`// ${directive} -- required fixture shape\nconst x = 1;`);
    accepted(`// Q-20261108-abcd\n// ${directive}\nconst x = 1;`);
  }
  for (const directive of ["@ts-ignore", "@ts-nocheck"]) {
    refused(`// ${directive} -- not a permitted reason form`);
    accepted(`// ${directive} BKLG-20261108-abcd`);
  }
});

test("skip true and test.skip names are refused", () => {
  refused('test("x", { skip: true }, () => {});');
  refused('test.skip("x", () => {});');
  refused('describe.todo("x");');
  refused('it("x", { todo: true }, () => {});');
});

test("skip option string, test-context reason and preceding comment are accepted", () => {
  accepted('test("x", { skip: "needs a live relay" }, () => {});');
  accepted('t.skip("needs a live relay");');
  accepted('// needs a live relay\ntest.skip("x", () => {});');
  accepted('test("x", context => { context.todo("needs a live relay"); });');
  accepted('test("x", { skip: false }, () => {});');
});

test("context skip without a reason and blank directive descriptions are refused", () => {
  refused("t.skip();");
  refused("// @ts-expect-error   \nconst x = 1;");
  refused("// eslint-disable --   \nconst x = 1;");
});

test("disabled ESLint rules including numeric and array levels need a comment", () => {
  for (const level of ['"off"', "0", '["off", {}]']) {
    refused(`export default { rules: { "no-console": ${level} } };`, "eslint.config.mjs");
    accepted(`export default { rules: {\n// output is the command interface\n"no-console": ${level} } };`, "eslint.config.mjs");
  }
  accepted('export default { ignores: ["dist/**"] };', "eslint.config.mjs");
});

test("strict false and every installed strict flag false need a comment", () => {
  for (const flag of ["strict", "noImplicitAny", "strictNullChecks", "strictFunctionTypes", "strictBindCallApply", "strictPropertyInitialization", "noImplicitThis", "alwaysStrict", "useUnknownInCatchVariables", "strictBuiltinIteratorReturn"]) {
    refused(`{ "compilerOptions": { "${flag}": false } }`, "tsconfig.test.json");
    accepted(`{ "compilerOptions": {\n// types are deliberately incomplete in this fixture\n"${flag}": false } }`, "tsconfig.test.json");
  }
  accepted('{ "compilerOptions": { "strict": true, "skipLibCheck": true } }', "tsconfig.json");
});

test("new 2001-line source file is refused", () => {
  refused(lines(2001));
  accepted(lines(2000));
});

test("held file growth is refused and shrinkage names the number to write", () => {
  const held = { held_files: { "src/example.ts": 2002 } };
  refused(lines(2003), "src/example.ts", held);
  const result = refused(lines(2001), "src/example.ts", held);
  assert.ok(result.errors.some((error: string) => error.includes("write 2001 to the baseline")));
  accepted(lines(2002), "src/example.ts", held);
});

test("held file at 2000 lines or deleted must leave the baseline", () => {
  assert.ok(refused(lines(2000), "src/example.ts", { held_files: { "src/example.ts": 2001 } }).errors.some((error: string) => error.includes("remove it")));
  assert.ok(checkFloor({ files: {}, baseline: baseline({ held_files: { "src/deleted.ts": 2001 } }) }).errors.some((error: string) => error.includes("remove it")));
});

test("vendored bundle, fixtures, output and JSON are excluded from the size hold", () => {
  for (const file of ["src/policy-client-bundle/bundle.ts", "data.json", "tsconfig.test.json", "test/fixtures/data.ts", "dist/out.js", ".tmp/scratch.mjs", ".worktrees/other/a.ts"]) accepted(lines(2001), file);
});

test("one anonymous directive matches baseline 1 but fails 0 and a second fails 1", () => {
  const one = "// eslint-disable no-console\n";
  accepted(one, undefined, { anonymous_markers: 1 });
  refused(one);
  refused(`${one}// prettier-ignore\n`, undefined, { anonymous_markers: 1 });
});

test("any failed floor check lists every existing anonymous marker", () => {
  const result = checkFloor({ files: { "src/example.ts": "// prettier-ignore\n" }, baseline: baseline({ anonymous_markers: 1, eslint_suppressions: 1 }) });
  assert.ok(result.errors.includes("src/example.ts:1: anonymous prettier-ignore"));
});

test("anonymous marker count below baseline names the lower number", () => {
  assert.ok(check("", undefined, { anonymous_markers: 1 }).errors.some((error: string) => error.includes("write 0 to the baseline")));
});

test("suppression totals above and below baseline are refused", () => {
  const suppressions = { "src/example.ts": { "no-console": { count: 2 } } };
  for (const count of [1, 3]) {
    const result = checkFloor({ files: {}, baseline: baseline({ eslint_suppressions: count }), suppressions });
    assert.ok(result.errors.some((error: string) => error.startsWith("eslint_suppressions:")));
    if (count === 3) assert.ok(result.errors.some((error: string) => error.includes("write 2 to the baseline")));
  }
  assert.deepEqual(checkFloor({ files: {}, baseline: baseline({ eslint_suppressions: 2 }), suppressions }).errors, []);
});

test("suppression and held-file baselines need non-empty reasons", () => {
  assert.ok(checkFloor({ files: {}, baseline: baseline({ eslint_suppressions: 1, reason: "" }), suppressions: { a: { rule: { count: 1 } } } }).errors.some((error: string) => error.includes("non-empty reason")));
  assert.ok(check(lines(2001), undefined, { held_files: { "src/example.ts": 2001 }, held_reason: " " }).errors.some((error: string) => error.includes("non-empty held_reason")));
});

test("every baseline count is held against the merge-base baseline", () => {
  const previousBaseline = baseline({ held_files: { "src/example.ts": 2001 } });
  for (const change of [{ anonymous_markers: 1 }, { eslint_suppressions: 1 }, { held_files: { "src/example.ts": 2002 } }, { held_files: { "src/new.ts": 2001 } }]) {
    const result = checkFloor({ files: {}, baseline: baseline(change), previousBaseline });
    assert.ok(result.errors.some((error: string) => error.includes("baseline grew")));
  }
});

test("invalid baseline counts and suppression counts fail closed", () => {
  assert.throws(() => checkFloor({ files: {}, baseline: baseline({ anonymous_markers: -1 }) }), /nonnegative integer/);
  assert.throws(() => checkFloor({ files: {}, baseline: baseline(), suppressions: { a: { rule: { count: "2" } } } }), /nonnegative integer/);
});

test("missing origin/main prints baseline growth not checked and passes", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "liskov-floor-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd });
    const result = checkFloor({ files: {}, baseline: baseline(), ...readHistoryBaseline(cwd) });
    assert.deepEqual(result.errors, []);
    assert.match(result.messages.join("\n"), /floor: baseline growth not checked .*origin\/main/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("history adapter reads the merge-base baseline and refuses a grown candidate", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "liskov-floor-history-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd });
    mkdirSync(path.join(cwd, "scripts"));
    writeFileSync(path.join(cwd, "scripts/floor-baseline.json"), JSON.stringify(baseline()));
    execFileSync("git", ["add", "scripts/floor-baseline.json"], { cwd });
    execFileSync("git", ["-c", "user.name=Floor Test", "-c", "user.email=floor@example.invalid", "commit", "--quiet", "-m", "fixture"], { cwd });
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd });
    const result = checkFloor({ files: {}, baseline: baseline({ anonymous_markers: 1 }), ...readHistoryBaseline(cwd) });
    assert.ok(result.errors.includes("anonymous_markers: baseline grew from 0 to 1"));
    assert.deepEqual(result.messages, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
