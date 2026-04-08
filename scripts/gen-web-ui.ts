/**
 * Build script: reads src/core/browser-signer/index.html
 * and generates src/core/browser-signer/web-ui.ts with the HTML inlined as a string.
 *
 * Usage: npx tsx scripts/gen-web-ui.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(__dirname, "../src/core/browser-signer/index.html");
const outPath = resolve(__dirname, "../src/core/browser-signer/web-ui.ts");

const html = readFileSync(htmlPath, "utf-8");
const escaped = html.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");

const code = `// AUTO-GENERATED from index.html — do not edit directly.
// Regenerate: npm run gen:web-ui

const HTML = \`${escaped}\`;

export function getIndexHtml(): string {
  return HTML;
}
`;

writeFileSync(outPath, code, "utf-8");
console.log(`Generated ${outPath} (${html.length} bytes of HTML inlined)`);
