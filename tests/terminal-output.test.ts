import { expect, test } from "bun:test";
import { formatStatus, supportsTerminalColor } from "../src/terminal-output.js";

test("formats aligned plain status lines without terminal escape sequences", () => {
  const ready = formatStatus("ready", "gateway · http://127.0.0.1:41241/", false);
  const workspace = formatStatus("workspace", "/trusted/project", false);

  expect(ready).toBe("  ready      gateway · http://127.0.0.1:41241/");
  expect(workspace).toBe("  workspace  /trusted/project");
  expect(`${ready}\n${workspace}`).not.toContain("\u001b[");
});

test("uses one accent only for interactive terminals unless color is disabled", () => {
  const line = formatStatus("ready", "gateway", true);

  expect(line).toContain("\u001b[1;36mready     \u001b[0m");
  expect(line).toContain(" gateway");
  expect(supportsTerminalColor({ isTTY: true } as NodeJS.WriteStream, {})).toBe(true);
  expect(supportsTerminalColor({ isTTY: true } as NodeJS.WriteStream, { NO_COLOR: "" })).toBe(
    false,
  );
  expect(supportsTerminalColor({ isTTY: false } as NodeJS.WriteStream, {})).toBe(false);
  expect(supportsTerminalColor({ isTTY: true } as NodeJS.WriteStream, { TERM: "dumb" })).toBe(
    false,
  );
});
