import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ledgerId = /\b(?:BKLG|EPIC|Q)-\d{8}-[a-z0-9]{4}\b/;
const deferral = /^(?:TODO|FIXME|XXX|HACK)(?:[^a-zA-Z]|$)/;
const directive = /^(eslint-disable(?:-next-line|-line)?|@ts-ignore|@ts-expect-error|@ts-nocheck|prettier-ignore|c8\s+ignore|istanbul\s+ignore)\b(.*)/;
const strictFlags = new Set(["strict", ...ts.optionDeclarations.filter(option => option.strictFlag).map(option => option.name)]);
const testNames = new Set(["test", "it", "describe"]);
const baselinePath = "scripts/floor-baseline.json";

function included(file) {
  return !/^(?:src\/policy-client-bundle\/|test\/fixtures\/|dist\/|\.tmp\/|node_modules\/|\.worktrees\/)/.test(file)
    && (/\.(?:[cm]?ts|[cm]?js)$/.test(file) || /(?:^|\/)tsconfig[^/]*\.json$/.test(file));
}

// Compiler-owned trivia ranges at syntax boundaries avoid treating literal contents as comments.
function commentsIn(source) {
  const ranges = new Map();
  function visit(node) {
    for (const offset of [node.pos, node.end]) {
      for (const range of [...ts.getLeadingCommentRanges(source.text, offset) ?? [], ...ts.getTrailingCommentRanges(source.text, offset) ?? []]) {
        ranges.set(range.pos, range);
      }
    }
    for (const child of node.getChildren(source)) visit(child);
  }
  visit(source);
  return [...ranges.values()].flatMap(range => {
    const start = source.getLineAndCharacterOfPosition(range.pos).line;
    return source.text.slice(range.pos + 2, range.end - (range.kind === ts.SyntaxKind.MultiLineCommentTrivia ? 2 : 0))
      .split(/\r?\n/).map((text, index) => ({ line: start + index, text: text.trim().replace(/^\*\s?/, "").trim() }));
  });
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}

function callRoot(expression) {
  while (ts.isPropertyAccessExpression(expression)) expression = expression.expression;
  return ts.isIdentifier(expression) ? expression.text : undefined;
}

function hasStringReason(node) {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.trim().length > 0;
}

function markersIn(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".json") ? ts.ScriptKind.JSON : undefined);
  const lines = text.split(/\r?\n/);
  const comments = commentsIn(source);
  const markers = [];
  const contexts = new Set(["t"]);
  const hasId = line => ledgerId.test(`${lines[line - 1] ?? ""}\n${lines[line] ?? ""}`);
  const hasComment = line => comments.some(comment => (comment.line === line || comment.line === line - 1) && comment.text.length > 0);
  const add = (line, kind, reason = false) => {
    if (!hasId(line) && !reason) markers.push({ file, line: line + 1, kind });
  };
  for (const comment of comments) {
    if (deferral.test(comment.text)) add(comment.line, "deferral");
    const match = directive.exec(comment.text);
    if (match) {
      const reason = match[1] === "@ts-expect-error" ? match[2].trim().length > 0
        : !["@ts-ignore", "@ts-nocheck"].includes(match[1]) && /\s--\s+\S/.test(match[2]);
      add(comment.line, match[1], reason);
    }
  }
  function visit(node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    if (ts.isCallExpression(node)) {
      const root = callRoot(node.expression);
      if (testNames.has(root)) {
        for (const argument of node.arguments) {
          if ((ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) && argument.parameters[0] && ts.isIdentifier(argument.parameters[0].name)) {
            contexts.add(argument.parameters[0].name.text);
          }
          if (ts.isObjectLiteralExpression(argument)) {
            for (const option of argument.properties) {
              if (ts.isPropertyAssignment(option) && ["skip", "todo"].includes(propertyName(option.name)) && option.initializer.kind === ts.SyntaxKind.TrueKeyword) {
                const optionLine = source.getLineAndCharacterOfPosition(option.getStart(source)).line;
                add(optionLine, "skipped test", hasComment(optionLine));
              }
            }
          }
        }
      }
      if (ts.isPropertyAccessExpression(node.expression) && ["skip", "todo"].includes(node.expression.name.text)
        && (testNames.has(root) || contexts.has(root))) {
        add(line, "skipped test", hasComment(line) || (contexts.has(root) && hasStringReason(node.arguments[0])));
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (file === "eslint.config.mjs" && name === "rules" && ts.isObjectLiteralExpression(node.initializer)) {
        for (const rule of node.initializer.properties) {
          if (!ts.isPropertyAssignment(rule)) continue;
          const level = ts.isArrayLiteralExpression(rule.initializer) ? rule.initializer.elements[0] : rule.initializer;
          if (level && ((ts.isStringLiteral(level) && level.text === "off") || (ts.isNumericLiteral(level) && level.text === "0"))) {
            const ruleLine = source.getLineAndCharacterOfPosition(rule.getStart(source)).line;
            add(ruleLine, "disabled lint rule", hasComment(ruleLine));
          }
        }
      }
      if (/(?:^|\/)tsconfig[^/]*\.json$/.test(file) && name === "compilerOptions" && ts.isObjectLiteralExpression(node.initializer)) {
        for (const option of node.initializer.properties) {
          if (ts.isPropertyAssignment(option) && strictFlags.has(propertyName(option.name)) && option.initializer.kind === ts.SyntaxKind.FalseKeyword) {
            const optionLine = source.getLineAndCharacterOfPosition(option.getStart(source)).line;
            add(optionLine, "disabled strict flag", hasComment(optionLine));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return markers;
}

function validateBaseline(baseline) {
  if (baseline === null || typeof baseline !== "object" || Array.isArray(baseline)) throw new Error("baseline must be an object");
  for (const key of ["anonymous_markers", "eslint_suppressions"]) {
    if (!Number.isSafeInteger(baseline[key]) || baseline[key] < 0) throw new Error(`${key} must be a nonnegative integer`);
  }
  if (baseline.held_files === null || typeof baseline.held_files !== "object" || Array.isArray(baseline.held_files)) throw new Error("held_files must be an object");
  for (const [file, count] of Object.entries(baseline.held_files)) {
    if (!included(file) || file.endsWith(".json") || !Number.isSafeInteger(count) || count <= 2000) throw new Error(`invalid held file: ${file}`);
  }
}

function suppressionCount(suppressions) {
  let total = 0;
  for (const rules of Object.values(suppressions)) {
    for (const entry of Object.values(rules)) {
      if (!Number.isSafeInteger(entry.count) || entry.count < 0) throw new Error("suppression count must be a nonnegative integer");
      total += entry.count;
    }
  }
  return total;
}

/** One policy interface for the command and in-memory regression tests. */
export function checkFloor({ files, baseline, suppressions = {}, previousBaseline = null, historyNote = "no merge-base baseline" }) {
  validateBaseline(baseline);
  const errors = [];
  const messages = [];
  const anonymousMarkers = [];
  const sizes = new Map();
  for (const [file, text] of Object.entries(files)) {
    if (!included(file)) continue;
    anonymousMarkers.push(...markersIn(file, text));
    if (!file.endsWith(".json")) sizes.set(file, text === "" ? 0 : text.split("\n").length - Number(text.endsWith("\n")));
  }
  const total = suppressionCount(suppressions);
  function exact(label, actual, expected) {
    if (actual !== expected) errors.push(`${label}: ${actual} ${actual > expected ? "exceeds" : "is below"} baseline ${expected}; ${actual < expected ? `write ${actual} to the baseline` : "new debt is refused"}`);
  }
  exact("anonymous_markers", anonymousMarkers.length, baseline.anonymous_markers);
  exact("eslint_suppressions", total, baseline.eslint_suppressions);
  if (total > 0 && (typeof baseline.reason !== "string" || baseline.reason.trim() === "")) errors.push("eslint_suppressions requires a non-empty reason");
  if (Object.keys(baseline.held_files).length > 0 && (typeof baseline.held_reason !== "string" || baseline.held_reason.trim() === "")) errors.push("held_files requires a non-empty held_reason");
  for (const [file, count] of sizes) {
    if (count > 2000 && !Object.hasOwn(baseline.held_files, file)) errors.push(`${file}: ${count} lines exceeds 2000; new oversized file is refused`);
  }
  for (const [file, count] of Object.entries(baseline.held_files)) {
    const actual = sizes.get(file) ?? 0;
    if (actual <= 2000) errors.push(`${file}: ${actual} lines; remove it from held_files`);
    else exact(`${file}: lines`, actual, count);
  }
  if (previousBaseline === null) messages.push(`floor: baseline growth not checked (${historyNote})`);
  else {
    validateBaseline(previousBaseline);
    for (const key of ["anonymous_markers", "eslint_suppressions"]) {
      if (baseline[key] > previousBaseline[key]) errors.push(`${key}: baseline grew from ${previousBaseline[key]} to ${baseline[key]}`);
    }
    for (const [file, count] of Object.entries(baseline.held_files)) {
      if (!Object.hasOwn(previousBaseline.held_files, file) || count > previousBaseline.held_files[file]) errors.push(`${file}: held baseline grew from merge base`);
    }
  }
  if (errors.length > 0) errors.push(...anonymousMarkers.map(marker => `${marker.file}:${marker.line}: anonymous ${marker.kind}`));
  return { errors, messages, anonymousMarkers, suppressionTotal: total, heldFiles: Object.fromEntries([...sizes].filter(([, count]) => count > 2000)) };
}

export function readHistoryBaseline(cwd) {
  let base;
  try {
    base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return { historyNote: "merge base unavailable (origin/main or history missing)" };
  }
  let text;
  try {
    text = execFileSync("git", ["show", `${base}:${baselinePath}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return { historyNote: `no baseline at merge base ${base}` };
  }
  return { previousBaseline: JSON.parse(text) };
}

function main() {
  const cwd = process.cwd();
  const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd, encoding: "utf8" }).split("\0").filter(included);
  const files = Object.fromEntries([...new Set(paths)].map(file => [file, readFileSync(file, "utf8")]));
  const result = checkFloor({ files, baseline: JSON.parse(readFileSync(baselinePath, "utf8")), suppressions: JSON.parse(readFileSync("eslint-suppressions.json", "utf8")), ...readHistoryBaseline(cwd) });
  for (const message of result.messages) console.log(message);
  for (const error of result.errors) console.error(`floor: ${error}`);
  if (result.errors.length > 0) process.exitCode = 1;
  else console.log(`floor: ${result.anonymousMarkers.length} anonymous markers, ${result.suppressionTotal} lint suppressions, ${Object.keys(result.heldFiles).length} held files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    console.error(`floor: ${error.message}`);
    process.exitCode = 1;
  }
}
