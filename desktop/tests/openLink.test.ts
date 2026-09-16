import { strict as assert } from "node:assert";
import test from "node:test";
import { srcOf } from "../src/openLink.ts";

test("reads src from an open link", () => {
  assert.equal(
    srcOf("nurb://open?src=https%3A%2F%2Fnurb.dev%2Fp%2Fbracket"),
    "https://nurb.dev/p/bracket",
  );
});

test("a link with no src is not an open link", () => {
  assert.equal(srcOf("nurb://open"), null);
});

test("another path is not an open link", () => {
  assert.equal(srcOf("nurb://settings?src=x"), null);
});

test("a malformed url is not an open link", () => {
  assert.equal(srcOf("nurb:/ /open"), null);
});

test("a src carrying its own query survives percent-encoding", () => {
  assert.equal(
    srcOf("nurb://open?src=https%3A%2F%2Fnurb.dev%2Fp%2Fx%2Fstl%3Fv%3D1%26o%3Dyz"),
    "https://nurb.dev/p/x/stl?v=1&o=yz",
  );
});

test("an empty src is not an open link", () => {
  assert.equal(srcOf("nurb://open?src="), null);
});
