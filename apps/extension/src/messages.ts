import type { TranscriptSegment, VideoInfo, SubtitleTrack } from "@video-to-doc/contracts";

export type PageDetection = { video: VideoInfo; tracks: SubtitleTrack[] };

export type ExtensionMessage =
  | { type: "DETECT_PAGE" }
  | { type: "READ_SUBTITLE"; platform: VideoInfo["platform"]; trackId: string }
  | { type: "START_TAB_CAPTURE"; captureId: string; apiUrl: string; accessToken: string }
  | { type: "STOP_TAB_CAPTURE" }
  | { type: "LOGIN"; apiUrl: string }
  | { type: "PAGE_CHANGED"; url: string }
  | { type: "CAPTURE_PROGRESS"; uploadedChunks: number }
  | { type: "CAPTURE_STOPPED"; captureId: string }
  | { type: "CAPTURE_ERROR"; message: string };

export interface SubtitleResponse { segments: TranscriptSegment[] }
