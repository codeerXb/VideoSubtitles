import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import OpenAI from "openai";
import { documentPayloadSchema, type DocumentPayload, type DocumentTemplate, type OutputLanguage, type TranscriptSegment } from "@video-to-doc/contracts";

export interface TranscriptionProvider {
  transcribe(filePath: string): Promise<{ language: string; segments: TranscriptSegment[] }>;
}

export interface DocumentProvider {
  generate(input: { sourceTitle: string; template: DocumentTemplate; outputLanguage: OutputLanguage; segments: TranscriptSegment[] }): Promise<DocumentPayload>;
}

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  private client(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");
    return new OpenAI({ apiKey });
  }

  async transcribe(filePath: string): Promise<{ language: string; segments: TranscriptSegment[] }> {
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL;
    if (!model) throw new Error("OPENAI_TRANSCRIPTION_MODEL_MISSING");
    const result = await this.client().audio.transcriptions.create({
      file: createReadStream(filePath),
      model,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    } as never) as unknown as { language?: string; text: string; segments?: Array<{ start: number; end: number; text: string }> };
    const segments = result.segments?.map((segment, sourceIndex) => ({ startMs: Math.round(segment.start * 1_000), endMs: Math.round(segment.end * 1_000), text: segment.text.trim(), sourceIndex })).filter((segment) => segment.text.length > 0) ?? [];
    return { language: result.language ?? "und", segments: segments.length ? segments : fallbackSegments(result.text) };
  }
}

export class OpenAIDocumentProvider implements DocumentProvider {
  private client(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY_MISSING");
    return new OpenAI({ apiKey });
  }

  async generate(input: { sourceTitle: string; template: DocumentTemplate; outputLanguage: OutputLanguage; segments: TranscriptSegment[] }): Promise<DocumentPayload> {
    const { buildDocumentInput, splitTranscript } = await import("./pipeline");
    const prompt = buildDocumentInput({ template: input.template, outputLanguage: input.outputLanguage, sourceTitle: input.sourceTitle, transcriptChunks: splitTranscript(input.segments) });
    const model = process.env.OPENAI_DOCUMENT_MODEL;
    if (!model) throw new Error("OPENAI_DOCUMENT_MODEL_MISSING");
    const response = await this.client().responses.create({
      model,
      input: prompt,
      text: { format: { type: "json_schema", name: "video_document", strict: true, schema: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, summary: { type: "string" }, sections: { type: "array", items: { type: "object", additionalProperties: false, properties: { heading: { type: "string" }, body: { type: "string" }, startMs: { type: "integer", minimum: 0 } }, required: ["heading", "body", "startMs"] } } }, required: ["title", "summary", "sections"] } } } as never,
    });
    return documentPayloadSchema.parse(JSON.parse(response.output_text));
  }
}

export function fallbackSegments(text: string, durationMs = 30_000): TranscriptSegment[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  return [{ startMs: 0, endMs: durationMs, text: cleaned, sourceIndex: 0 }];
}

export async function readAsBuffer(path: string): Promise<Buffer> { return readFile(path); }
