import type { DocumentPayload, Platform, TranscriptSegment } from "@video-to-doc/contracts";

export const MAX_CAPTURE_DURATION_MS = 60 * 60 * 1_000;
export const MONTHLY_QUOTA_MS = 5 * 60 * 60 * 1_000;

export function normalizeTranscript(segments: TranscriptSegment[]): TranscriptSegment[] {
  const normalized = segments
    .map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, " ").trim() }))
    .filter((segment) => segment.text.length > 0)
    .sort((left, right) => left.startMs - right.startMs || left.sourceIndex - right.sourceIndex);

  return normalized.reduce<TranscriptSegment[]>((result, segment) => {
    const previous = result.at(-1);
    if (previous?.text === segment.text && segment.startMs <= previous.endMs + 250) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      return result;
    }
    result.push({ ...segment });
    return result;
  }, []);
}

export type QuotaDecision =
  | { allowed: true; remainingMs: number }
  | { allowed: false; reason: "TASK_TOO_LONG" | "MONTHLY_QUOTA_EXCEEDED"; remainingMs: number };

export function canProcessDuration(usedMs: number, requestedMs: number): QuotaDecision {
  const remainingMs = Math.max(0, MONTHLY_QUOTA_MS - usedMs);
  if (requestedMs > MAX_CAPTURE_DURATION_MS) {
    return { allowed: false, reason: "TASK_TOO_LONG", remainingMs };
  }
  if (requestedMs > remainingMs) {
    return { allowed: false, reason: "MONTHLY_QUOTA_EXCEEDED", remainingMs };
  }
  return { allowed: true, remainingMs: remainingMs - requestedMs };
}

export function buildTimestampUrl(platform: Platform, sourceUrl: string, timeMs: number): string {
  const url = new URL(sourceUrl);
  const seconds = Math.max(0, Math.floor(timeMs / 1_000));
  url.searchParams.set("t", platform === "YOUTUBE" ? `${seconds}s` : String(seconds));
  return url.toString();
}

function formatTimestamp(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function renderMarkdown(input: {
  sourceTitle: string;
  sourceUrl: string;
  platform: Platform;
  document: DocumentPayload;
}): string {
  const sections = input.document.sections.map((section) => {
    const timestampUrl = buildTimestampUrl(input.platform, input.sourceUrl, section.startMs);
    return `## ${section.heading}\n\n${section.body}\n\n[${formatTimestamp(section.startMs)}](${timestampUrl})`;
  });

  return [
    `# ${input.document.title}`,
    `来源：[${input.sourceTitle}](${input.sourceUrl})`,
    input.document.summary,
    ...sections,
  ].join("\n\n");
}
