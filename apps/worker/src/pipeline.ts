import type { DocumentTemplate, OutputLanguage, TranscriptSegment } from "@video-to-doc/contracts";

function timestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function splitTranscript(segments: TranscriptSegment[], maxCharacters = 12_000): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const segment of segments) {
    const line = `[${timestamp(segment.startMs)}] ${segment.text}`;
    if (current && current.length + 1 + line.length > maxCharacters) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function buildDocumentInput(input: {
  template: DocumentTemplate;
  outputLanguage: OutputLanguage;
  sourceTitle: string;
  transcriptChunks: string[];
}): string {
  const language = input.outputLanguage === "ZH_CN" ? "使用简体中文" : "保持字幕原语言";
  const format = input.template === "STRUCTURED_NOTES" ? "结构化学习笔记" : "逻辑完整的文章";
  return [
    `请根据视频《${input.sourceTitle}》的逐字稿生成${format}。`,
    `${language}。不得添加逐字稿中没有的信息。`,
    "每个章节必须提供 startMs，值应对应支持该章节内容的最早字幕时间。",
    "返回严格符合给定 JSON Schema 的 title、summary 和 sections。",
    "逐字稿：",
    ...input.transcriptChunks,
  ].join("\n\n");
}
