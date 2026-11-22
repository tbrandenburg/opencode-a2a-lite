import { expect, test } from "bun:test";
import { resumeRefusal, wantedSession } from "../src/resume.js";

const id = "ses_dfc114de7ffecIV2y1jJ0U0akj";

test("R1: only well-formed opencode session ids are accepted from metadata", () => {
  expect(wantedSession(undefined)).toBeUndefined();
  expect(wantedSession({ other: 1 })).toBeUndefined();
  expect(wantedSession({ "opencode.sessionId": id })).toEqual({ id });
  for (const bad of [
    "",
    "ses_",
    "ses_short",
    "ses_../../etc",
    `ses_${"a".repeat(65)}`,
    "x" + id,
    7,
    null,
    {},
  ])
    expect(wantedSession({ "opencode.sessionId": bad })).toMatchObject({
      error: expect.any(String),
    });
});

test("R2: refusals cover disabled, invalid, rebinding and shared sessions", () => {
  const wanted = { id };
  expect(resumeRefusal(wanted, false, undefined, [])).toContain("--allow-resume");
  expect(resumeRefusal({ error: "Invalid" }, true, undefined, [])).toBe("Invalid");
  expect(resumeRefusal({ error: "Invalid" }, false, undefined, [])).toContain("--allow-resume");
  expect(resumeRefusal(wanted, true, "ses_otherother1", [])).toContain("different session");
  expect(resumeRefusal(wanted, true, undefined, ["ses_x0000000", id])).toContain("another context");
  expect(resumeRefusal(wanted, true, id, [id])).toBeUndefined();
  expect(resumeRefusal(wanted, true, undefined, ["ses_x0000000"])).toBeUndefined();
});
