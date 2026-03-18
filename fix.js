import fs from 'fs';
let content = fs.readFileSync('src/core/tools.ts', 'utf8');
content = content.replace(
  /\} from "\.\/services\.getGlobalNetwork\(\)\.js";/,
  '} from "./chains.js";'
);
fs.writeFileSync('src/core/tools.ts', content);
