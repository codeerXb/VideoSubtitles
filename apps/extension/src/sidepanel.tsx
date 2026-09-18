import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SubtitleTrack, TranscriptSegment, VideoInfo } from "@video-to-doc/contracts";
import "./styles.css";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function send<T>(message: object): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as T & { error?: string };
  if (response?.error) throw new Error(response.error);
  return response;
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { message?: string } | null)?.message ?? `请求失败：${response.status}`);
  return response.json() as Promise<T>;
}

function App() {
  const [accessToken, setAccessToken] = useState("");
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [trackId, setTrackId] = useState("");
  const [status, setStatus] = useState("正在检测视频…");
  const [recording, setRecording] = useState(false);

  const detect = async () => {
    try {
      setStatus("正在检测视频…");
      const detection = await send<{ video: VideoInfo; tracks: SubtitleTrack[] }>({ type: "DETECT_PAGE" });
      setVideo(detection.video);
      setTracks(detection.tracks);
      setTrackId(detection.tracks[0]?.id ?? "");
      setStatus(detection.tracks.length ? "已找到字幕" : "未找到字幕，可录制当前标签页音频");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void chrome.storage.local.get(["accessToken"]).then((value) => setAccessToken(typeof value.accessToken === "string" ? value.accessToken : ""));
    void detect();
    const listener = (message: { type?: string; uploadedChunks?: number; message?: string }) => {
      if (message.type === "PAGE_CHANGED") void detect();
      if (message.type === "CAPTURE_PROGRESS") setStatus(`录制中，已上传 ${message.uploadedChunks ?? 0} 个分片`);
      if (message.type === "CAPTURE_STOPPED") { setRecording(false); setStatus("录制完成，正在云端处理"); }
      if (message.type === "CAPTURE_ERROR") setStatus(message.message ?? "录制失败");
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const login = async () => {
    const tokens = await send<{ accessToken: string }>({ type: "LOGIN", apiUrl });
    setAccessToken(tokens.accessToken);
  };

  const createCapture = (acquisitionMethod: "CAPTION" | "TAB_AUDIO") => {
    if (!video) throw new Error("尚未识别视频");
    return api<{ id: string }>("/v1/captures", accessToken, { method: "POST", body: JSON.stringify({ ...video, acquisitionMethod }) });
  };

  const submitSubtitle = async () => {
    if (!video || !trackId) return;
    setStatus("正在读取并提交字幕…");
    const { segments } = await send<{ segments: TranscriptSegment[] }>({ type: "READ_SUBTITLE", platform: video.platform, trackId });
    const capture = await createCapture("CAPTION");
    const selected = tracks.find((track) => track.id === trackId);
    await api(`/v1/captures/${capture.id}/subtitles`, accessToken, { method: "POST", body: JSON.stringify({ language: selected?.language ?? "und", segments }) });
    setStatus("字幕已提交，正在生成文档");
  };

  const toggleRecording = async () => {
    if (recording) {
      await send({ type: "STOP_TAB_CAPTURE" });
      setStatus("正在结束录制并提交剩余分片…");
      return;
    }
    const capture = await createCapture("TAB_AUDIO");
    await send({ type: "START_TAB_CAPTURE", captureId: capture.id, apiUrl, accessToken });
    setRecording(true);
    setStatus("录制中，最长60分钟");
  };

  return <main>
    <header><span className="eyebrow">VIDEO TO DOC</span><h1>把好视频变成可复用的知识</h1></header>
    {!accessToken ? <button className="primary" onClick={() => void login()}>邮箱登录</button> : <>
      <section className="card">
        <span className="platform">{video?.platform ?? "未识别"}</span>
        <h2>{video?.title ?? "请打开 YouTube 或 B站视频"}</h2>
        <p>{status}</p>
      </section>
      {tracks.length > 0 && <section className="card">
        <label>字幕轨道<select value={trackId} onChange={(event) => setTrackId(event.target.value)}>{tracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}</select></label>
        <button className="primary" onClick={() => void submitSubtitle().catch((error) => setStatus(error.message))}>提取字幕并生成文档</button>
      </section>}
      <button className={recording ? "danger" : "secondary"} onClick={() => void toggleRecording().catch((error) => setStatus(error.message))}>{recording ? "停止录制" : "录制当前标签页音频"}</button>
      <a className="workspace" href={`${apiUrl.replace(":3000", ":5173")}/tasks`} target="_blank">打开文档工作台 →</a>
    </>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
