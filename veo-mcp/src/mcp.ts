import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config, MODELS } from "./config.js";
import { listJobs, videoUrl, type Job } from "./store.js";
import { refreshJob, startGeneration, UserError } from "./veo.js";

function text(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    isError,
  };
}

function errorResult(err: unknown) {
  if (err instanceof UserError) return text(err.message, true);
  console.error(err);
  return text(`Unexpected server error: ${err instanceof Error ? err.message : String(err)}`, true);
}

function describe(job: Job) {
  return {
    operation_id: job.id,
    status: job.status,
    prompt: job.prompt,
    ...(job.negativePrompt ? { negative_prompt: job.negativePrompt } : {}),
    model: job.model,
    aspect_ratio: job.aspectRatio,
    created_at: job.createdAt,
    ...(job.completedAt ? { completed_at: job.completedAt } : {}),
    ...(job.file ? { download_url: videoUrl(job) } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

const modelList = Object.entries(MODELS)
  .map(([id, label]) => `${id} (${label})`)
  .join("; ");

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "veo-video", version: "2.0.0" });

  server.registerTool(
    "generate_video",
    {
      title: "Generate video",
      description:
        `Starts generating a ~${config.durationSeconds} second video with native audio (sound effects, music and spoken dialogue) using Google Gemini Omni ` +
          "through the Gemini Interactions API. Returns an operation_id immediately; " +
        "generation usually takes 1–6 minutes. Then call check_video_status with that operation_id (wait ~30–60 s between checks). " +
        "Write the prompt in English for best results; describe subject, action, camera, style, and any dialogue (in quotes) or sounds. " +
        `Available models: ${modelList}.`,
      inputSchema: {
        prompt: z.string().min(1).max(4000).describe("Detailed description of the video, including sound/dialogue if wanted."),
        aspect_ratio: z.enum(["9:16", "16:9"]).default("9:16").describe('"9:16" vertical (default, Reels/Shorts) or "16:9" horizontal.'),
        model: z
          .string()
          .optional()
          .describe(`Model name, passed to the API as-is. Default: ${config.defaultModel}. Available: ${Object.keys(MODELS).join(", ")}.`),
        negative_prompt: z.string().max(2000).optional().describe("Things the video should NOT contain, e.g. \"text, watermark, blurry\". Appended to the prompt as \"Do not include: …\"."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ prompt, aspect_ratio, model, negative_prompt }) => {
      try {
        const job = await startGeneration({ prompt, aspectRatio: aspect_ratio, model, negativePrompt: negative_prompt });
        return text({
          operation_id: job.id,
          status: "pending",
          model: job.model,
          aspect_ratio: job.aspectRatio,
          message: "Video generation started. Call check_video_status with this operation_id in about 60 seconds.",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "check_video_status",
    {
      title: "Check video status",
      description:
        "Checks a video generation started by generate_video. If done, returns download_url (a public .mp4 link). " +
        "If still pending, wait 30–60 seconds and check again. If failed or blocked by safety filters, returns the reason.",
      inputSchema: {
        operation_id: z.string().min(1).describe("The operation_id returned by generate_video."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ operation_id }) => {
      try {
        const job = await refreshJob(operation_id.trim());
        const info = describe(job);
        if (job.status === "pending") {
          return text({ ...info, message: "Still generating. Check again in 30–60 seconds." });
        }
        if (job.status === "failed") return text({ ...info, message: `Video generation failed: ${job.error}` }, true);
        return text({ ...info, message: `Video is ready: ${videoUrl(job)}` });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_videos",
    {
      title: "List generated videos",
      description: `Lists recently generated videos (kept for ${config.retentionDays} days) with their download URLs, prompts and status.`,
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of videos to return."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const jobs = listJobs().slice(0, limit);
      return text({ count: jobs.length, homepage: config.publicBaseUrl, videos: jobs.map(describe) });
    },
  );

  return server;
}
