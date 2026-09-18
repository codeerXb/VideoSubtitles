import { useEffect, useState } from "react";
import { API_URL, request } from "./api";
import "./styles.css";

type Task = {
  id: string;
  status: string;
  acquisitionMethod: string;
  createdAt: string;
  videoSource: { title: string; sourceUrl: string; platform: string; durationMs: number };
  documents: Array<{ id: string; title: string; template: string; outputLanguage: string }>;
};

type TaskDetail = Task & {
  transcript?: { language: string; segments: Array<{ startMs: number; endMs: number; text: string }> };
};

type DocumentDetail = { id: string; title: string; template: string; outputLanguage: string; userContent?: string | null; payload: { title: string; summary: string; sections: Array<{ heading: string; body: string; startMs: number }> } };

function Login() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState("");
  const returnTo = new URLSearchParams(location.search).get("return_to") ?? undefined;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await request<{ message: string; devLink?: string }>("/v1/auth/request-link", { method: "POST", body: JSON.stringify({ email, returnTo }) });
      setMessage(result.message);
      setDevLink(result.devLink ?? "");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <main className="shell login-shell">
    <div className="brand"><span>VIDEO TO DOC</span><h1>把视频变成<em>可复用的知识</em></h1><p>提取字幕，整理思路，留下可以再次使用的资料。</p></div>
    <form className="login-card" onSubmit={(event) => void submit(event)}>
      <h2>邀请用户登录</h2><p>输入被邀请的邮箱，我们会发送一次性登录链接。</p>
      <label>邮箱<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <button className="primary" type="submit">发送登录链接</button>
      {message && <p className="notice">{message}</p>}
      {devLink && <a className="dev-link" href={devLink}>打开开发环境登录链接</a>}
    </form>
  </main>;
}

function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<TaskDetail | null>(null);
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [documentContent, setDocumentContent] = useState("");
  const [message, setMessage] = useState("正在加载任务…");
  const load = async () => {
    try { const result = await request<Task[]>("/v1/captures"); setTasks(result); setMessage(result.length ? "" : "还没有任务，从浏览器插件开始吧。"); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void load(); }, []);
  const open = async (id: string) => {
    try {
      const task = await request<TaskDetail>(`/v1/captures/${id}`);
      setSelected(task);
      const firstDocument = task.documents[0];
      if (firstDocument) {
        const detail = await request<DocumentDetail>(`/v1/documents/${firstDocument.id}`);
        setDocument(detail);
        setDocumentContent(detail.userContent ?? renderDocumentText(detail));
      } else {
        setDocument(null);
        setDocumentContent("");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const generate = async (template: "STRUCTURED_NOTES" | "ARTICLE") => { if (!selected) return; await request(`/v1/documents/from-capture/${selected.id}`, { method: "POST", body: JSON.stringify({ template, outputLanguage: "ZH_CN" }) }); setMessage("文档生成任务已提交，稍后刷新任务即可查看"); };
  const saveDocument = async () => { if (!document) return; await request(`/v1/documents/${document.id}`, { method: "PATCH", body: JSON.stringify({ content: documentContent }) }); setMessage("文档已保存"); };
  return <main className="shell workspace-shell">
    <nav><span className="eyebrow">VIDEO TO DOC</span><a href="/tasks">任务</a><a href={`${API_URL}/v1/auth/session`}>会话</a></nav>
    <section className="workspace-header"><div><span className="eyebrow">YOUR LIBRARY</span><h1>视频资料库</h1><p>从浏览器插件提交一个视频，文档会在这里出现。</p></div><a className="secondary-button" href="http://localhost:5173/login">重新登录</a></section>
    {message && <div className="notice">{message}</div>}
    <div className="workspace-grid"><section className="task-list">{tasks.map((task) => <button className={`task-row ${selected?.id === task.id ? "active" : ""}`} key={task.id} onClick={() => void open(task.id)}><span className="task-platform">{task.videoSource.platform}</span><strong>{task.videoSource.title}</strong><small>{task.status} · {new Date(task.createdAt).toLocaleString()}</small></button>)}</section>
      <section className="detail-panel">{selected ? <><span className="task-platform">{selected.videoSource.platform}</span><h2>{selected.videoSource.title}</h2><a href={selected.videoSource.sourceUrl} target="_blank">打开原视频 ↗</a><div className="actions"><button className="primary" onClick={() => void generate("STRUCTURED_NOTES")}>生成结构化笔记</button><button className="secondary-button" onClick={() => void generate("ARTICLE")}>生成文章</button></div><h3>逐字稿 {selected.transcript ? `· ${selected.transcript.language}` : ""}</h3><div className="transcript">{selected.transcript?.segments.map((segment, index) => <p key={`${segment.startMs}-${index}`}><a href={`${selected.videoSource.sourceUrl}&t=${Math.floor(segment.startMs / 1_000)}s`} target="_blank">{Math.floor(segment.startMs / 60_000).toString().padStart(2, "0")}:{Math.floor(segment.startMs / 1_000 % 60).toString().padStart(2, "0")}</a> {segment.text}</p>) ?? <p>逐字稿尚未生成。</p>}</div>{document && <section className="document-editor"><div className="document-toolbar"><h3>{document.title}</h3><span>{document.template === "ARTICLE" ? "文章" : "结构化笔记"}</span></div><textarea value={documentContent} onChange={(event) => setDocumentContent(event.target.value)} aria-label="文档内容" /><div className="document-actions"><button className="primary" onClick={() => void saveDocument()}>保存修改</button><a className="secondary-button" href={`${API_URL}/v1/documents/${document.id}/export?format=md`}>下载 Markdown</a><a className="secondary-button" href={`${API_URL}/v1/documents/${document.id}/export?format=docx`}>下载 Word</a></div></section>}</> : <div className="empty"><div className="empty-mark">✦</div><h2>选择一个任务</h2><p>逐字稿、时间点和生成的文档会在这里呈现。</p></div>}</section></div>
  </main>;
}

export function App() { return location.pathname.startsWith("/tasks") ? <Dashboard /> : <Login />; }

function renderDocumentText(document: DocumentDetail): string { return [`# ${document.payload.title}`, document.payload.summary, ...document.payload.sections.map((section) => `## ${section.heading}\n\n${section.body}`)].join("\n\n"); }
