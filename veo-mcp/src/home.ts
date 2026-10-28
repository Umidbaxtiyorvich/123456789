import { config } from "./config.js";
import { videoUrl, type Job } from "./store.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function card(job: Job): string {
  const url = videoUrl(job);
  const when = new Date(job.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Tashkent" });
  const vertical = job.aspectRatio === "9:16";
  let media: string;
  if (job.status === "done" && url) {
    media = `
      <div class="player ${vertical ? "v" : "h"}">
        <video src="${esc(url)}" preload="metadata" controls playsinline></video>
        <button class="play" type="button" aria-label="Play">▶</button>
      </div>
      <a class="dl" href="${esc(url)}" download>⬇ Yuklab olish (.mp4)</a>`;
  } else if (job.status === "pending") {
    media = `<div class="state pending">⏳ Yaratilmoqda…</div>`;
  } else {
    media = `<div class="state failed">❌ ${esc(job.error ?? "Xato")}</div>`;
  }
  return `
    <article class="card">
      ${media}
      <p class="prompt">${esc(job.prompt)}</p>
      <p class="meta">${esc(job.model)} · ${esc(job.aspectRatio)} · ${esc(when)}</p>
    </article>`;
}

export function renderHome({ jobs, models }: { jobs: Job[]; models: Record<string, string> }): string {
  const keyOk = Boolean(config.geminiApiKey);
  const done = jobs.filter((j) => j.status === "done").length;
  const pending = jobs.filter((j) => j.status === "pending").length;
  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veo MCP Server</title>
<style>
  :root { --bg:#f6f7f9; --fg:#14161a; --muted:#6b7280; --card:#fff; --line:#e5e7eb; --ok:#15803d; --bad:#b91c1c; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --fg:#e8eaed; --muted:#9aa0a6; --card:#181b21; --line:#2a2f37; --ok:#4ade80; --bad:#f87171; --accent:#60a5fa; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:1100px; margin:0 auto; padding:24px 16px 48px; }
  h1 { margin:0 0 4px; font-size:24px; }
  .status { display:flex; flex-wrap:wrap; gap:8px 20px; margin:12px 0 24px; padding:14px 16px; background:var(--card); border:1px solid var(--line); border-radius:12px; }
  .ok { color:var(--ok); } .bad { color:var(--bad); } .muted { color:var(--muted); }
  .grid { display:grid; align-items:start; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px; }
  .player { position:relative; background:#000; border-radius:8px; overflow:hidden; }
  .player.v { aspect-ratio:9/16; } .player.h { aspect-ratio:16/9; }
  .player video { width:100%; height:100%; object-fit:contain; display:block; }
  .play { position:absolute; inset:0; margin:auto; width:64px; height:64px; border-radius:50%; border:0; background:rgba(0,0,0,.6); color:#fff; font-size:26px; cursor:pointer; }
  .player.playing .play { display:none; }
  .state { padding:40px 12px; text-align:center; border-radius:8px; background:var(--bg); font-size:14px; word-break:break-word; }
  .failed { color:var(--bad); text-align:left; white-space:pre-wrap; }
  .prompt { margin:0; font-size:14px; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
  .meta { margin:0; font-size:12px; color:var(--muted); }
  .dl { font-size:13px; color:var(--accent); text-decoration:none; }
  ul { margin:4px 0 0; padding-left:20px; }
</style>
</head>
<body>
<main>
  <h1>🎬 Veo MCP Server</h1>
  <p class="muted">Google Veo orqali video yaratish uchun Claude connector'i.</p>
  <section class="status">
    <span class="ok">● Server ishlayapti</span>
    <span class="${keyOk ? "ok" : "bad"}">${keyOk ? "● GEMINI_API_KEY o'rnatilgan" : "● GEMINI_API_KEY o'rnatilmagan!"}</span>
    <span>Videolar: <b>${done}</b> tayyor${pending ? `, <b>${pending}</b> jarayonda` : ""}</span>
    <span class="muted">Standart model: ${esc(config.defaultModel)} · Fayllar ${config.retentionDays} kun saqlanadi</span>
  </section>
  ${
    jobs.length
      ? `<section class="grid">${jobs.map(card).join("")}</section>`
      : `<p class="muted">Hali video yo'q. Claude'da: “Veo bilan … haqida video yarat” deb yozing.</p>`
  }
  <details style="margin-top:28px"><summary class="muted">Mavjud modellar</summary>
    <ul>${Object.entries(models).map(([id, label]) => `<li><code>${esc(id)}</code> — ${esc(label)}</li>`).join("")}</ul>
  </details>
</main>
<script>
  document.querySelectorAll(".player").forEach((p) => {
    const v = p.querySelector("video");
    p.querySelector(".play").addEventListener("click", () => v.play());
    v.addEventListener("play", () => {
      document.querySelectorAll(".player video").forEach((o) => { if (o !== v) o.pause(); });
      p.classList.add("playing");
    });
    v.addEventListener("pause", () => p.classList.remove("playing"));
  });
  // Refresh while something is still generating, but never interrupt a playing video.
  if (${'${pending}'}) setInterval(() => {
    if (![...document.querySelectorAll("video")].some((v) => !v.paused)) location.reload();
  }, 30000);
</script>
</body>
</html>`;
}
