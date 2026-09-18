import { describe, expect, it } from "vitest";
import { createCaptureSchema, documentPayloadSchema, transcriptSegmentSchema } from "../src/index";

describe("shared API contracts", () => {
  it("rejects a capture longer than the one-hour MVP limit", () => {
    const result = createCaptureSchema.safeParse({
      platform: "YOUTUBE",
      acquisitionMethod: "CAPTION",
      sourceId: "video-123",
      sourceUrl: "https://www.youtube.com/watch?v=video-123",
      title: "Long lecture",
      durationMs: 3_600_001,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a normalized transcript segment with a stable source index", () => {
    expect(transcriptSegmentSchema.parse({ startMs: 1_000, endMs: 2_500, text: "Hello world", sourceIndex: 7 })).toEqual({
      startMs: 1_000,
      endMs: 2_500,
      text: "Hello world",
      sourceIndex: 7,
    });
  });

  it("rejects document sections with a negative timestamp", () => {
    const result = documentPayloadSchema.safeParse({
      title: "Notes",
      summary: "Summary",
      sections: [{ heading: "Late", body: "Body", startMs: -1 }],
    });
    expect(result.success).toBe(false);
  });
});
