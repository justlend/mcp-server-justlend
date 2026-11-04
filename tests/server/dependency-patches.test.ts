import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const require = createRequire(import.meta.url);
const uri = require("fast-uri");

describe("Zod collection size preflight — GHSA-mrhx-c7xc-m3w5", () => {
  it.each([2, 3, 4])("checks max 3 before parsing %i elements", (length) => {
    const visit = vi.fn(() => true);
    const result = z.array(z.number().refine(visit)).max(3).safeParse(Array(length).fill(1));
    expect(result.success).toBe(length <= 3);
    expect(visit).toHaveBeenCalledTimes(length <= 3 ? length : 0);
    if (!result.success) expect(result.error.issues).toMatchObject([{ code: "too_big" }]);
  });

  it.each([2, 3, 4])("also preflights %i elements in asynchronous parsing", async (length) => {
    const visit = vi.fn(async () => true);
    const result = await z.array(z.number().refine(visit)).max(3).safeParseAsync(Array(length).fill(1));
    expect(result.success).toBe(length <= 3);
    expect(visit).toHaveBeenCalledTimes(length <= 3 ? length : 0);
    if (!result.success) expect(result.error.issues).toMatchObject([{ code: "too_big" }]);
  });
});

describe("fast-uri security parsing contracts", () => {
  it("rejects an encoded scheme rather than promoting it into a live scheme", () => {
    expect(uri.parse("h%74tps://example.com/").error).toBeTruthy();
  });

  it("rejects ambiguous hostname delimiters rather than rewriting the authority", () => {
    expect(uri.parse("https://example.com%2f.evil.test/").error).toBeTruthy();
  });

  it("preserves ordinary HTTPS parsing", () => {
    expect(uri.parse("https://example.com/path")).toMatchObject({ scheme: "https", host: "example.com", path: "/path" });
  });

  it("does not change relative resolution when normalizing a parent segment", () => {
    const reference = "a/../../b";
    const normalized = uri.normalize(reference);
    expect(uri.resolve("https://example.com/x/y/", normalized)).toBe(uri.resolve("https://example.com/x/y/", reference));
  });

  it("escapes a first-segment colon in a suffix reference", () => {
    const reference = uri.serialize({ path: "javascript:alert(1)" }, { reference: "suffix" });
    expect(reference).not.toMatch(/^javascript:/);
    expect(uri.parse(reference).scheme).toBeUndefined();
  });
});

// Run the upstream crash scenario in a child: a regression must fail this test,
// not terminate Vitest or touch any real server/wallet. All traffic is loopback.
const compressedBodyProbe = String.raw`
const http = require('node:http');
const zlib = require('node:zlib');
const parser = require(process.argv[1]);
const encoding = process.argv[2];
const withTrailing = process.argv[3] === 'trailing';
const compressed = encoding === 'gzip' ? zlib.gzipSync('{"a":1}') : zlib.deflateSync('{"a":1}');
const first = withTrailing ? Buffer.concat([compressed, Buffer.from([0])]) : compressed;
const trailing = withTrailing ? Buffer.alloc(1024, 0x58) : Buffer.alloc(0);
let request;
const server = http.createServer((req, res) => {
  if (req.method === 'GET') return res.end('alive');
  parser.json()(req, res, (error) => {
    if (error) { res.statusCode = error.status || 500; return res.end(error.message); }
    const finish = () => res.end(JSON.stringify(req.body));
    if (req.readableEnded) finish(); else req.once('end', finish);
    if (withTrailing) request.end(trailing);
    req.resume();
  });
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  request = http.request({ hostname: '127.0.0.1', port, method: 'POST', agent: false,
    headers: { 'content-type': 'application/json', 'content-encoding': encoding,
      'content-length': first.length + trailing.length } }, (res) => {
    let body = '';
    res.setEncoding('utf8'); res.on('data', part => { body += part; });
    res.on('end', () => {
      http.get({ hostname: '127.0.0.1', port, agent: false }, (health) => {
        let alive = ''; health.on('data', part => { alive += part; });
        health.on('end', () => { console.log(JSON.stringify({ status: res.statusCode, body, alive })); server.close(); });
      }).on('error', error => { throw error; });
    });
  });
  request.on('error', error => { throw error; });
  if (withTrailing) request.write(first); else request.end(first);
});
`;

const expressRequire = createRequire(require.resolve("express/package.json"));
const sdkRequire = createRequire(require.resolve("@modelcontextprotocol/sdk/server/mcp.js"));
const sdkExpressRequire = createRequire(sdkRequire.resolve("express/package.json"));

describe.each([
  ["HTTP Express 4", expressRequire.resolve("body-parser")],
  ["SDK Express 5", sdkExpressRequire.resolve("body-parser")],
])("%s compressed-body lifecycle — GHSA-27r3-jxmh-p828", (_label, parserPath) => {
  it.each([
    ["gzip", "valid"], ["gzip", "trailing"], ["deflate", "trailing"],
  ])("survives %s with %s bytes and serves the next request", (encoding, mode) => {
    const output = execFileSync(process.execPath, ["-e", compressedBodyProbe, parserPath, encoding, mode], {
      encoding: "utf8", timeout: 8000, maxBuffer: 16 * 1024,
    });
    expect(JSON.parse(output)).toEqual({ status: 200, body: '{"a":1}', alive: "alive" });
  }, 10_000);
});
