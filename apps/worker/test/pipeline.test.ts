import { describe, expect, it } from "vitest";
import { buildDocumentInput, splitTranscript } from "../src/pipeline";

describe("worker document pipeline", () => {
  it("splits a long transcript on segment boundaries and preserves order", () => {
    const chunks = splitTranscript([
      { startMs: 0, endMs: 1_000, text: "alpha", sourceIndex: 0 },
      { startMs: 1_000, endMs: 2_000, text: "bravo", sourceIndex: 1 },
      { startMs: 2_000, endMs: 3_000, text: "charlie", sourceIndex: 2 },
    ], 28);
    expect(chunks).toEqual([
      "[00:00] alpha\n[00:01] bravo",
      "[00:02] charlie",
    ]);
  });

  it("asks for Chinese structured notes while requiring timestamp grounding", () => {
    const input = buildDocumentInput({
      template: "STRUCTURED_NOTES",
      outputLanguage: "ZH_CN",
      sourceTitle: "Vectors",
      transcriptChunks: ["[00:00] Vectors encode meaning."],
    });
    expect(input).toContain("使用简体中文");
    expect(input).toContain("结构化学习笔记");
    expect(input).toContain("startMs");
    expect(input).toContain("[00:00] Vectors encode meaning.");
  });
});
