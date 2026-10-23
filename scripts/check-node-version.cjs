// Match the security-patched release lines declared in package.json.
function isSupportedNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  const minimum = { 22: [23, 4], 24: [22, 1], 26: [12, 1] }[major];
  return major > 26 || Boolean(minimum && (
    minor > minimum[0] || (minor === minimum[0] && patch >= minimum[1])
  ));
}

module.exports = { isSupportedNodeVersion };

if (require.main === module && !isSupportedNodeVersion(process.version)) {
  console.error(`Unsupported Node.js ${process.version}. Use 22.23.4+ (22.x), 24.22.1+ (24.x), or 26.12.1+.`);
  process.exitCode = 1;
}
