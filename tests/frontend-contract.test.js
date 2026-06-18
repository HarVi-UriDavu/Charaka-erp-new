import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("clinical save reads follow-up controls by their rendered names", () => {
  assert.match(app, /document\.querySelector\("\[name=followUpDate\]"\)\.value/);
  assert.match(app, /document\.querySelector\("\[name=followUpReason\]"\)\.value/);
  assert.doesNotMatch(app, /byId\("followUpDate"\)/);
  assert.doesNotMatch(app, /byId\("followUpReason"\)/);
});
