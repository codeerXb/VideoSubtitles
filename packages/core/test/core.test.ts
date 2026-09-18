import { describe, expect, it } from "vitest";
import { buildTimestampUrl, canProcessDuration, normalizeTranscript, renderMarkdown } from "../src/index";

describe("transcript normalization", () => {
  it("trims text and removes adjacent duplicate captions", () => {
    expect(normalizeTranscript([
      { startMs: 0, endMs: 1_000, text: "  Hello  ", sourceIndex: 0 },
      { startMs: 900, endMs: 2_000, text: "Hello", sourceIndex: 1 },
      { startMs: 2_000, endMs: 3_000, text: "world", sourceIndex: 2 },
    ])).toEqual([
      { startMs: 0, endMs: 2_000, text: "Hello", sourceIndex: 0 },
      { startMs: 2_000, endMs: 3_000, text: "world", sourceIndex: 2 },
    ]);
  });
});

describe("quota policy", () => {
  it("allows exactly sixty minutes when monthly quota remains", () => {
    expect(canProcessDuration(0, 3_600_000)).toEqual({ allowed: true, remainingMs: 14_400_000 });
  });

  it("rejects work that would exceed five hours in the calendar month", () => {
    expect(canProcessDuration(17_400_000, 900_000)).toEqual({
      allowed: false,
      reason: "MONTHLY_QUOTA_EXCEEDED",
      remainingMs: 600_000,
    });
  });
});

describe("timestamp links", () => {
  it("builds YouTube and Bilibili links without discarding query params", () => {
    expect(buildTimestampUrl("YOUTUBE", "https://www.youtube.com/watch?v=abc", 65_900)).toBe("https://www.youtube.com/watch?v=abc&t=65s");
    expect(buildTimestampUrl("BILIBILI", "https://www.bilibili.com/video/BV1xx?p=2", 65_900)).toBe("https://www.bilibili.com/video/BV1xx?p=2&t=65");
  });
});

describe("Markdown export", () => {
  it("includes source metadata and timestamped sections", () => {
    const markdown = renderMarkdown({
      sourceTitle: "Vector databases",
      sourceUrl: "https://www.youtube.com/watch?v=abc",
      platform: "YOUTUBE",
      document: {
        title: "向量数据库笔记",
        summary: "核心概念摘要。",
        sections: [{ heading: "定义", body: "向量数据库用于相似度检索。", startMs: 75_000 }],
      },
    });
    expect(markdown).toContain("# 向量数据库笔记");
    expect(markdown).toContain("来源：[Vector databases](https://www.youtube.com/watch?v=abc)");
    expect(markdown).toContain("[01:15](https://www.youtube.com/watch?v=abc&t=75s)");
  });
});
