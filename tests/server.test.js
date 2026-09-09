import { test, expect } from "bun:test";
import { isValidName } from "../server.js";

test("accepts a plain .mmd name", () => {
  expect(isValidName("my-diagram.mmd")).toBe(true);
});

test("rejects a name without .mmd", () => {
  expect(isValidName("my-diagram")).toBe(false);
});

test("rejects a name with a path in it", () => {
  expect(isValidName("../secret.mmd")).toBe(false);
});
