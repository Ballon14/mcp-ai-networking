import { test } from "node:test";
import assert from "node:assert/strict";
import { redactObject, redactText, isSensitiveKey } from "../src/lib/redact.mjs";
import { pageRows } from "../src/lib/truncate.mjs";

test("redacts known secret keys recursively", () => {
  const input = {
    name: "rule-1",
    address: "192.168.88.1",
    password: "hunter2",
    nested: {
      "pre-shared-key": "wifi-secret",
      privateKeyName: "keep-me",
      "private-key": "-----BEGIN",
      community: "public"
    },
    list: [{ secret: "abc", port: 22 }]
  };

  const output = redactObject(input);

  assert.equal(output.password, "[REDACTED]");
  assert.equal(output.nested["pre-shared-key"], "[REDACTED]");
  assert.equal(output.nested["private-key"], "[REDACTED]");
  assert.equal(output.nested.community, "[REDACTED]");
  assert.equal(output.list[0].secret, "[REDACTED]");
  assert.equal(output.name, "rule-1");
  assert.equal(output.address, "192.168.88.1");
  assert.equal(output.nested.privateKeyName, "keep-me");
  assert.equal(output.list[0].port, 22);
  assert.ok(!JSON.stringify(output).includes("hunter2"));
  assert.ok(!JSON.stringify(output).includes("wifi-secret"));
});

test("detects sensitive key names", () => {
  for (const key of [
    "password",
    "passphrase",
    "secret",
    "psk",
    "pre-shared-key",
    "wpa2-pre-shared-key",
    "private-key",
    "radius-secret",
    "api-password",
    "wifi-passphrase",
    "community"
  ]) {
    assert.equal(isSensitiveKey(key), true, `${key} should be sensitive`);
  }

  for (const key of ["name", "comment", "public-key", "key-id", "address", "gateway"]) {
    assert.equal(isSensitiveKey(key), false, `${key} should not be sensitive`);
  }
});

test("redacts secret patterns inside free-form text", () => {
  const text = "failed login password=supersecret from 10.0.0.1, key='abc'";
  const output = redactText(text);

  assert.ok(!output.includes("supersecret"));
  assert.ok(!output.includes("'abc'"));
  assert.ok(output.includes("password=[REDACTED]"));
});

test("pageRows slices data and reports truncation", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: index }));

  const page = pageRows(rows, { limit: 3, offset: 2 });

  assert.deepEqual(
    page.rows.map((row) => row.id),
    [2, 3, 4]
  );
  assert.equal(page.total, 10);
  assert.equal(page.offset, 2);
  assert.equal(page.limit, 3);
  assert.equal(page.truncated, true);
});

test("pageRows clamps invalid paging values", () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ id: index }));

  const page = pageRows(rows, { limit: 1000, offset: -4 }, { maxLimit: 4 });

  assert.equal(page.limit, 4);
  assert.equal(page.offset, 0);
  assert.equal(page.rows.length, 4);
});
