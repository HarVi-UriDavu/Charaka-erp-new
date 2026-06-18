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

test("fixed-choice clinical and registration fields render as dropdowns", () => {
  for (const name of ["guardianRel", "bloodGroup", "followUpReason", "dose", "frequency", "days", "reason"]) {
    assert.match(app, new RegExp(`selectField\\("${name}"`));
  }
  assert.match(app, /selectField\("category"/);
  assert.match(app, /selectField\("form"/);
  assert.match(app, /selectField\("gst"/);
});

test("dropdown helper preserves existing values outside the current option list", () => {
  assert.match(app, /selected && !options\.map\(String\)\.includes\(selected\)/);
});
