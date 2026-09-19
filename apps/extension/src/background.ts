import { buildYouTubeSubtitleRequestUrls, normalizeYouTubePlayerResponse, parseBilibiliPageData, parseBilibiliSubtitle, parseYouTubePlayerResponse, parseYouTubeSubtitleResponse } from "./adapters/parsers";
import type { ExtensionMessage, PageDetection, SubtitleResponse } from "./messages";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("找不到当前标签页");
  return tab;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type PageSnapshot = {
  url: string;
  youtube?: unknown;
  youtubeFallback?: unknown;
  bilibiliState?: unknown;
  bilibiliPlayInfo?: unknown;
};

async function readPageSnapshot(tabId: number): Promise<PageSnapshot> {
  let latest: PageSnapshot = { url: "" };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const injected = (await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const page = window as typeof window & {
          ytInitialPlayerResponse?: unknown;
          ytplayer?: { config?: { args?: { player_response?: unknown } } };
          __INITIAL_STATE__?: unknown;
          __playinfo__?: unknown;
        };
        return {
          url: location.href,
          youtube: page.ytInitialPlayerResponse,
          youtubeFallback: page.ytplayer?.config?.args?.player_response,
          bilibiliState: page.__INITIAL_STATE__,
          bilibiliPlayInfo: page.__playinfo__,
        };
      },
    }))[0]?.result as PageSnapshot | undefined;
    if (injected) {
      latest = injected;
      const youtubeReady = normalizeYouTubePlayerResponse(injected.youtube) ?? normalizeYouTubePlayerResponse(injected.youtubeFallback);
      if (youtubeReady || injected.bilibiliState) return injected;
    }
    if (attempt < 5) await wait(500);
  }
  return latest;
}

async function detectPage(): Promise<PageDetection> {
  const tab = await activeTab();
  const result = await readPageSnapshot(tab.id!);

  if (!result) throw new Error("无法读取视频页面信息");
  if (result.url.includes("youtube.com/")) {
    const response = normalizeYouTubePlayerResponse(result.youtube) ?? normalizeYouTubePlayerResponse(result.youtubeFallback);
    return parseYouTubePlayerResponse(response ?? {}, result.url);
  }
  if (result.url.includes("bilibili.com/video/")) {
    return parseBilibiliPageData({ state: result.bilibiliState as never, playInfo: result.bilibiliPlayInfo as never }, result.url);
  }
  throw new Error("当前页面不是受支持的 YouTube 或 B站视频页");
}

type SubtitleFetchResult = { ok: boolean; status: number; body: string };

async function fetchSubtitleInPage(tabId: number, url: string): Promise<SubtitleFetchResult> {
  const injected = (await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (subtitleUrl: string) => {
      const response = await fetch(subtitleUrl, { credentials: "include" });
      return { ok: response.ok, status: response.status, body: await response.text() };
    },
    args: [url],
  }))[0]?.result as SubtitleFetchResult | undefined;
  if (!injected) throw new Error("无法在视频页面读取字幕");
  return injected;
}

async function fetchSubtitleInExtension(url: string): Promise<SubtitleFetchResult> {
  const response = await fetch(url, { credentials: "include" });
  return { ok: response.ok, status: response.status, body: await response.text() };
}

async function readSubtitle(platform: "YOUTUBE" | "BILIBILI", trackId: string): Promise<SubtitleResponse> {
  const tab = await activeTab();
  const urls = platform === "YOUTUBE" ? buildYouTubeSubtitleRequestUrls(trackId) : [new URL(trackId).toString()];
  let lastStatus = 0;
  let hadResponse = false;
  let lastError: unknown;

  for (const url of urls) {
    let result: SubtitleFetchResult | undefined;
    try {
      result = await fetchSubtitleInPage(tab.id!, url);
    } catch (error) {
      lastError = error;
    }
    if (!result) {
      try {
        result = await fetchSubtitleInExtension(url);
      } catch (error) {
        lastError = error;
      }
    }
    if (!result) continue;
    hadResponse = true;
    lastStatus = result.status;
    if (!result.ok || !result.body.trim()) continue;

    const segments = platform === "YOUTUBE"
      ? parseYouTubeSubtitleResponse(result.body)
      : (() => {
        try {
          return parseBilibiliSubtitle(JSON.parse(result.body) as never);
        } catch {
          return [];
        }
      })();
    if (segments.length) return { segments };
  }

  if (lastStatus >= 400) throw new Error(`字幕请求失败：${lastStatus}`);
  if (lastError && !hadResponse) throw new Error("无法读取字幕接口，请刷新视频页面后重试");
  throw new Error("字幕接口返回空内容，请刷新视频页面后重试");
}

async function ensureOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Record the user-selected tab audio in 15-second chunks",
    });
  } catch {
    // A document already exists; Chrome reports that as a rejected promise.
  }
}

async function startCapture(message: Extract<ExtensionMessage, { type: "START_TAB_CAPTURE" }>): Promise<void> {
  const tab = await activeTab();
  await ensureOffscreenDocument();
  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(id);
    });
  });
  await chrome.runtime.sendMessage({ ...message, target: "offscreen", streamId });
}

async function login(apiUrl: string): Promise<{ accessToken: string; refreshToken: string }> {
  const redirectUri = chrome.identity.getRedirectURL("auth");
  const authUrl = `${apiUrl}/v1/auth/extension/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
  const callback = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!callback) throw new Error("登录未完成");
  const code = new URL(callback).searchParams.get("code");
  if (!code) throw new Error("登录回调缺少授权码");
  const response = await fetch(`${apiUrl}/v1/auth/extension/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!response.ok) throw new Error("插件令牌交换失败");
  const tokens = await response.json() as { accessToken: string; refreshToken: string };
  await chrome.storage.local.set(tokens);
  return tokens;
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage & { target?: string }, _sender, sendResponse) => {
  if (message.target === "offscreen") return false;
  const work = async () => {
    switch (message.type) {
      case "DETECT_PAGE": return detectPage();
      case "READ_SUBTITLE": return readSubtitle(message.platform, message.trackId);
      case "START_TAB_CAPTURE": await startCapture(message); return { ok: true };
      case "STOP_TAB_CAPTURE": await chrome.runtime.sendMessage({ ...message, target: "offscreen" }); return { ok: true };
      case "LOGIN": return login(message.apiUrl);
      default: return { ok: true };
    }
  };
  void work().then(sendResponse).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});
