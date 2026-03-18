const acorn = require('acorn');
const ts = require('typescript');
const fs = require('fs');
const content = fs.readFileSync('src/core/tools.ts', 'utf8');
const result = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
try {
  acorn.parse(result.outputText, { ecmaVersion: 2020 });
  console.error("Parsed successfully");
} catch (e) {
  let lines = result.outputText.split('\n');
  let errLine = e.loc.line - 1;
  console.error("Syntax Error: ", e.message, " at Line: ", e.loc.line);
  console.error("Context:");
  for (let i = Math.max(0, errLine - 5); i < Math.min(lines.length, errLine + 5); i++) {
    console.error(`${i + 1}: ${lines[i]}`);
  }
}
