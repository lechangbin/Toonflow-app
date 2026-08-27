import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  PromptProfileError,
  VideoPromptProfileRegistry,
  createVideoPromptDraftInstruction,
  parseVideoPromptProfile,
  renderVideoPrompt,
} from "../src/video/promptProfile";

const profileRoot = path.join(process.cwd(), "data", "promptProfiles", "video");

test("loads immutable Video Prompt Profiles from their declared paths", () => {
  const registry = VideoPromptProfileRegistry.load(profileRoot);
  assert.ok(registry.get("agnes/keyframe-v1"));
  assert.ok(registry.get("seedance/image-v1"));
  assert.ok(registry.get("minimax/first-last-v1"));
});

test("rejects unknown frontmatter instead of silently accepting profile drift", () => {
  assert.throws(
    () =>
      parseVideoPromptProfile(
        `---\nid: agnes/text-v1\nschemaVersion: 1\ncapabilityId: text-to-video\ndefaultStrategy: standard\ndraftSections: [subject]\nattribution: native\nlegacyMode: text\n---\n# Guidance`,
        "invalid.md",
      ),
    (error: any) => error instanceof PromptProfileError && error.code === "PROFILE_FORMAT_INVALID",
  );
});

test("builds a structured-draft instruction and renders in declared order", () => {
  const profile = VideoPromptProfileRegistry.load(profileRoot).get("agnes/keyframe-v1");
  const instruction = createVideoPromptDraftInstruction(profile, {
    subject: "同一名宇航员",
    transition: "从首帧经过中间关键帧，连续到达尾帧",
    audio: "风声逐渐增强",
    references: [
      { role: "first-frame", intent: "起始状态", preserve: ["人物身份"], exclude: [] },
      { role: "intermediate-keyframe", intent: "时间中点", preserve: ["机位"], exclude: [] },
      { role: "last-frame", intent: "最终状态", preserve: ["人物身份"], exclude: [] },
    ],
  });
  assert.match(instruction, /Do not invent dialogue/);
  assert.match(instruction, /adjacent temporal targets/);

  const prompt = renderVideoPrompt(profile, {
    subject: "保持同一名宇航员的身份与服装。",
    transition: "从首帧平滑推进到中间关键帧，再自然抵达尾帧。",
    audio: "环境风声逐渐增强。",
  });
  assert.equal(
    prompt,
    "保持同一名宇航员的身份与服装。\n从首帧平滑推进到中间关键帧，再自然抵达尾帧。\n环境风声逐渐增强。",
  );
});
