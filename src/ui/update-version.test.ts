import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./update-version";

describe("release update selection", () => {
  it("skips intermediate releases and installs the newest stable version directly", () => {
    expect(isNewerVersion("0.3.13", "0.3.11")).toBe(true);
  });

  it("does not offer the installed or an older release", () => {
    expect(isNewerVersion("0.3.11", "0.3.11")).toBe(false);
    expect(isNewerVersion("0.3.10", "0.3.11")).toBe(false);
  });
});
