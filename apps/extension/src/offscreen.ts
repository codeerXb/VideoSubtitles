import type { ExtensionMessage } from "./messages";

let recorder: MediaRecorder | null = null;
let stopTimer: number | undefined;
let uploadChain = Promise.resolve();
const failedChunks = new Set<number>();
let current: { captureId: string; apiUrl: string; accessToken: string; nextChunk: number } | null = null;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function authenticatedFetch(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return response;
}

async function uploadChunk(blob: Blob, index: number): Promise<void> {
  if (!current) return;
  let lastError: unknown = new Error("音频分片上传失败");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const presign = await authenticatedFetch(`${current.apiUrl}/v1/captures/${current.captureId}/chunks/presign`, current.accessToken, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ index, contentType: blob.type || "audio/webm", size: blob.size }),
      });
      const { uploadUrl, chunkId } = await presign.json() as { uploadUrl: string; chunkId: string };
      const upload = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
      if (!upload.ok) throw new Error(`音频分片上传失败：${upload.status}`);
      await authenticatedFetch(`${current.apiUrl}/v1/captures/${current.captureId}/chunks/${chunkId}/complete`, current.accessToken, { method: "POST" });
      await chrome.runtime.sendMessage({ type: "CAPTURE_PROGRESS", uploadedChunks: index + 1 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await delay(1_000 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function start(message: Extract<ExtensionMessage, { type: "START_TAB_CAPTURE" }> & { streamId: string }): Promise<void> {
  if (recorder) throw new Error("已有录制任务正在进行");
  failedChunks.clear();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } } as MediaTrackConstraints,
    video: false,
  });
  const context = new AudioContext();
  context.createMediaStreamSource(stream).connect(context.destination);
  current = { captureId: message.captureId, apiUrl: message.apiUrl, accessToken: message.accessToken, nextChunk: 0 };
  recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
  recorder.addEventListener("dataavailable", (event) => {
    if (!event.data.size || !current) return;
    const index = current.nextChunk++;
    uploadChain = uploadChain.then(() => uploadChunk(event.data, index)).catch(async (error: unknown) => {
      failedChunks.add(index);
      await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", message: error instanceof Error ? error.message : String(error) });
    });
  });
  recorder.addEventListener("stop", async () => {
    window.clearTimeout(stopTimer);
    await uploadChain;
    if (current && failedChunks.size === 0) {
      await authenticatedFetch(`${current.apiUrl}/v1/captures/${current.captureId}/complete`, current.accessToken, { method: "POST" });
      await chrome.runtime.sendMessage({ type: "CAPTURE_STOPPED", captureId: current.captureId });
    } else if (current) {
      await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", message: `有 ${failedChunks.size} 个分片未上传，任务已保留，请重试或放弃` });
    }
    stream.getTracks().forEach((track) => track.stop());
    recorder = null;
    current = null;
  });
  recorder.start(15_000);
  stopTimer = window.setTimeout(() => recorder?.stop(), 3_600_000);
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage & { target?: string; streamId?: string }) => {
  if (message.target !== "offscreen") return false;
  if (message.type === "START_TAB_CAPTURE" && message.streamId) void start({ ...message, streamId: message.streamId });
  if (message.type === "STOP_TAB_CAPTURE" && recorder?.state !== "inactive") recorder?.stop();
  return false;
});
