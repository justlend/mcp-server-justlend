/**
 * Generate `integrity.json` — a release-integrity manifest for this MCP server.
 *
 * Why: agents and operators consume this server through two channels — the npm
 * tarball and raw files fetched from GitHub (most importantly `mcp-api-list.md`,
 * the offline tool catalog). This manifest pins both to content hashes anchored
 * at a specific git commit, so a consumer can verify that what they downloaded
 * is what this repository state actually produced (and that the tool surface
 * wasn't tampered with in transit). Pair it with a detached GPG signature
 * (`integrity.json.asc`) to also prove origin:
 *
 *   npm run gen:integrity
 *   gpg --armor --detach-sign integrity.json
 *   gpg --verify integrity.json.asc integrity.json
 *
 * Output is deterministic for a given commit: npm tarballs have normalized
 * mtimes, tsc output is stable, and the manifest records the commit's author
 * date instead of the wall clock — regenerating on an unchanged tree yields a
 * byte-identical file (same property `gen:api-list` has, and CI can enforce it
 * the same way).
 */
import { createHash } from "crypto";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd: string) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");

// --- package + git anchors -------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const gitCommit = sh("git rev-parse HEAD");
const gitCommitDate = sh("git show -s --format=%cI HEAD");
const gitTreeDirty = sh("git status --porcelain") !== "";

// --- npm tarball integrity (what `npm publish` would ship) ------------------
// `npm pack --dry-run --json` computes the reproducible tarball without
// leaving a .tgz behind. Requires a fresh `npm run build` (build/ is packed).
if (!existsSync(join(ROOT, "build"))) {
  console.error("error: build/ missing — run `npm run build` first (the tarball packs it).");
  process.exit(1);
}
const pack = JSON.parse(sh("npm pack --dry-run --json 2>/dev/null"))[0];

// --- agent-facing raw files (also fetched directly from GitHub) -------------
const RAW_FILES = ["mcp-api-list.md", "README.md", "CHANGELOG.md", "LICENSE", "package.json"];

// --- tool-surface cross-check from the generated catalog --------------------
const catalog = readFileSync(join(ROOT, "mcp-api-list.md"), "utf8");
const toolCount = Number(/\*\*Total tools\*\*:\s*(\d+)/.exec(catalog)?.[1] ?? NaN);
const readOnly = Number(/\*\*Read-only tools\*\*:\s*(\d+)/.exec(catalog)?.[1] ?? NaN);
const writeTools = Number(/\*\*Write tools\*\*:\s*(\d+)/.exec(catalog)?.[1] ?? NaN);
const destructive = Number(/destructive:\s*(\d+)/.exec(catalog)?.[1] ?? NaN);
if (!Number.isFinite(toolCount)) {
  console.error("error: could not parse tool count from mcp-api-list.md — regenerate it first.");
  process.exit(1);
}

const manifest = {
  name: pkg.name,
  version: pkg.version,
  git: { commit: gitCommit, commitDate: gitCommitDate, treeDirty: gitTreeDirty },
  toolSurface: { total: toolCount, readOnly, write: writeTools, destructive },
  npmTarball: {
    filename: pack.filename,
    integrity: pack.integrity, // sha512, same value npm records in package-lock
    shasum: pack.shasum,
    files: pack.entryCount,
    unpackedSize: pack.unpackedSize,
  },
  files: Object.fromEntries(RAW_FILES.map((f) => [f, { sha256: sha256(f) }])),
  verify: {
    tarball: "npm pack --dry-run --json  # compare .integrity / .shasum",
    file: "shasum -a 256 <file>  # compare files[<file>].sha256",
    signature: "gpg --verify integrity.json.asc integrity.json",
  },
};

console.log(JSON.stringify(manifest, null, 2));
