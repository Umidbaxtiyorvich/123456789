import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, MODELS, validateConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { cleanupOld, initStore, listJobs, videoUrl } from "./store.js";
import { refreshJob } from "./veo.js";
import { renderHome } from "./home.js";

validateConfig();
initStore();
cleanupOld();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

function tokenMatches(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(config.accessToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireToken(req: Request, res: Response, next: NextFunction) {
  if (tokenMatches(String(req.params.token ?? ""))) return next();
  res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: wrong or missing access token in URL" }, id: null });
}

// Stateless Streamable HTTP: a fresh server + transport per request, so it works across restarts and multiple instances.
app.post("/mcp/:token", requireToken, express.json({ limit: "1mb" }), async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.all("/mcp/:token", requireToken, (_req, res) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null });
});

app.all(["/mcp", "/mcp/"], (_req, res) => {
  res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: access token missing from URL (/mcp/<ACCESS_TOKEN>)" }, id: null });
});

app.use(
  "/videos",
  express.static(config.videosDir, {
    index: false,
    maxAge: "1d",
    setHeaders: (res) => res.setHeader("Content-Type", "video/mp4"),
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, gemini_key_configured: Boolean(config.geminiApiKey) });
});

app.get("/api/videos", (_req, res) => {
  res.json(listJobs().map((j) => ({ id: j.id, status: j.status, prompt: j.prompt, url: videoUrl(j), created_at: j.createdAt })));
});

app.get("/", (_req, res) => {
  res.type("html").send(renderHome({ jobs: listJobs(), models: MODELS }));
});

app.use((_req, res) => {
  res.status(404).type("text").send("Not found");
});

// Finish pending jobs in the background, so videos get saved even if nobody calls check_video_status
// (Google deletes generated files after 2 days).
setInterval(() => {
  for (const job of listJobs()) {
    if (job.status === "pending") refreshJob(job.id).catch(() => {});
  }
}, 20_000).unref();

setInterval(cleanupOld, 60 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`Video MCP server listening on port ${config.port}`);
  console.log(`Homepage:      ${config.publicBaseUrl}/`);
  console.log(`MCP endpoint:  ${config.publicBaseUrl}/mcp/<ACCESS_TOKEN>`);
});
