import { expect, test } from "bun:test";
import { resumeRefusal, wantedReplay, wantedSession } from "../src/resume.js";

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

test("R2: refusals cover disabled, invalid, rebinding, shared sessions and replay misuse", () => {
  const wanted = { id };
  const ask = (
    replay?: boolean | "invalid",
    w: { id: string } | { error: string } | null = wanted,
  ) => ({ wanted: w ?? undefined, replay });
  expect(resumeRefusal(ask(), false, undefined, [])).toContain("--enable resume");
  expect(resumeRefusal(ask(undefined, { error: "Invalid" }), true, undefined, [])).toBe("Invalid");
  expect(resumeRefusal(ask(undefined, { error: "Invalid" }), false, undefined, [])).toContain(
    "--enable resume",
  );
  expect(resumeRefusal(ask(), true, "ses_otherother1", [])).toContain("different session");
  expect(resumeRefusal(ask(), true, undefined, ["ses_x0000000", id])).toContain("another context");
  expect(resumeRefusal(ask(), true, id, [id])).toBeUndefined();
  expect(resumeRefusal(ask(), true, undefined, ["ses_x0000000"])).toBeUndefined();
  expect(resumeRefusal(ask(true), true, undefined, [])).toBeUndefined();
  expect(resumeRefusal(ask(false), true, undefined, [])).toBeUndefined();
  expect(resumeRefusal(ask(true, null), true, undefined, [])).toContain("first message");
  expect(resumeRefusal(ask(true), true, id, [id])).toContain("first message");
  expect(resumeRefusal(ask("invalid"), true, undefined, [])).toContain("true or false");
  expect(resumeRefusal(ask(true), false, undefined, [])).toContain("--enable resume");
});

test("R3: replay must be a boolean in metadata", () => {
  expect(wantedReplay({})).toBeUndefined();
  expect(wantedReplay({ "opencode.replay": true })).toBe(true);
  expect(wantedReplay({ "opencode.replay": false })).toBe(false);
  for (const bad of ["true", 1, null, {}])
    expect(wantedReplay({ "opencode.replay": bad })).toBe("invalid");
});
