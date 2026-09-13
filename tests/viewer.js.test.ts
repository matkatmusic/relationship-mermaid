import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("committed viewer.js matches a fresh build of viewer.ts byte for byte", () => {
  const outfile = join(tmpdir(), `viewer-build-${Date.now()}.js`);
  const result = spawnSync("bun", ["build", "viewer.ts", "--outfile", outfile]);
  assert.equal(result.status, 0);

  const built = readFileSync(outfile, "utf8");
  const committed = readFileSync("viewer.js", "utf8");
  assert.equal(built, committed);
});
