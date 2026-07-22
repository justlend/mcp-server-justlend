import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../../src/server/version.js";

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function readRepoJson(path: string): Record<string, any> {
  return JSON.parse(readRepoFile(path));
}

describe("version metadata", () => {
  const packageJson = readRepoJson("package.json");

  it("reports the package version at runtime", () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
  });

  it("keeps package and documentation metadata aligned", () => {
    const packageLock = readRepoJson("package-lock.json");
    const readme = readRepoFile("README.md");
    const apiList = readRepoFile("mcp-api-list.md");

    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[""].version).toBe(packageJson.version);
    expect(readme).toContain(`Current Version: v${packageJson.version}`);
    expect(apiList).toContain(`@justlend/mcp-server-justlend\` v${packageJson.version}`);
  });
});
