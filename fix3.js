import fs from 'fs';
let content = fs.readFileSync('tests/core/tools.test.ts', 'utf8');

// Inject the mock for getGlobalNetwork and setGlobalNetwork right after getConfiguredWallet
content = content.replace(
  /getConfiguredWallet(.*?\n.*?\}\),)/,
  \`getConfiguredWallet$1
  
  getGlobalNetwork: vi.fn(() => "mainnet"),
  setGlobalNetwork: vi.fn(),\`);

fs.writeFileSync('tests/core/tools.test.ts', content);
