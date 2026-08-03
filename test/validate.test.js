import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAddress,
  assertPercent,
  assertPositiveNumber,
} from "../src/utils/validate.js";

test("address validation accepts EVM addresses and rejects malformed input", () => {
  assert.doesNotThrow(() => assertAddress("0x1111111111111111111111111111111111111111", "wallet"));
  assert.throws(() => assertAddress("0x123", "wallet"), /valid 0x-prefixed/);
});

test("numeric validation enforces safe boundaries", () => {
  assert.doesNotThrow(() => assertPercent(10, "threshold"));
  assert.throws(() => assertPercent(0, "threshold"), /between 0 and 100/);
  assert.throws(() => assertPercent(101, "threshold"), /between 0 and 100/);
  assert.doesNotThrow(() => assertPositiveNumber(0.01, "price"));
  assert.throws(() => assertPositiveNumber(-1, "price"), /positive number/);
});
