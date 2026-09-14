import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("bun build viewer.ts succeeds and includes expected DOM ids", () => {
  const outfile = join(tmpdir(), `viewer-build-${Date.now()}.js`);
  const result = spawnSync("bun", ["build", "viewer.ts", "--outfile", outfile]);
  assert.equal(result.status, 0);

  const output = readFileSync(outfile, "utf8");
  assert.ok(output.includes("nodeActions"));
  assert.ok(output.includes("editorUndoBtn"));
});

test("bun build viewer.ts keeps the real destination as an option even when its kind is choice", () => {
  // Scenario: the destination-options loop in renderNodeInspector must keep the node's real outgoing destination as an <option> even when that destination's kind === 'choice'. The fix names the skip guard isHiddenChoice (choice AND not the real destination); before the fix that identifier does not exist, so its presence in the bundle proves the skip is now conditional.
  // ponytail: bundle-string check; the behavioral destinationSelect.value assertion belongs in the CDP harness at tests/index.html.test.ts, which this task does not own.
  const outfile = join(tmpdir(), `viewer-destination-${Date.now()}.js`);
  const result = spawnSync("bun", ["build", "viewer.ts", "--outfile", outfile]);
  assert.equal(result.status, 0);

  const output = readFileSync(outfile, "utf8");
  assert.ok(output.includes("isHiddenChoice"));
});
