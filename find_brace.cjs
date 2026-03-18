const fs = require('fs');
const content = fs.readFileSync('src/core/tools.ts', 'utf8');
let openCount = 0;
let lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  openCount += (lines[i].match(/\{/g) || []).length;
  openCount -= (lines[i].match(/\}/g) || []).length;
  if (openCount === 0 || openCount === 1) console.error(`Line ${i + 1}: count ${openCount}`);
}
