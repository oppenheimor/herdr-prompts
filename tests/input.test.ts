import { describe, expect, it } from "vitest";

import { isBackwardDeletionKey } from "../src/input.js";

describe("terminal input compatibility", () => {
  it.each([
    { backspace: true, delete: false },
    { backspace: false, delete: true },
  ])("treats $backspace/$delete as backward deletion", (key) => {
    expect(isBackwardDeletionKey(key)).toBe(true);
  });

  it("ignores unrelated keys", () => {
    expect(isBackwardDeletionKey({ backspace: false, delete: false })).toBe(
      false,
    );
  });
});
