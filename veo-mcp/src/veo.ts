import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { config } from "./config.js";
import { explainError, explainOperationError } from "./errors.js";
import { addJob, getJob, updateJob, type Job } from "./store.js";

let client: GoogleGenAI | undefined;

function ai(): GoogleGenAI {
  if (!config.geminiApiKey) {
    throw new UserError("GEMINI_API_KEY is not set on the server. Add it in the Render/Railway environment variables and redeploy.");
  }
  client ??= new GoogleGenAI({
    apiKey: config.geminiApiKey,
    httpOptions: config.geminiBaseUrl ? { baseUrl: config.geminiBaseUrl } : undefined,
  });
  return client;
}

/** An error whose message is already readable and should be shown as-is. */
export class UserError extends Error {}

export interface StartParams {
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  model?: string;
  negativePrompt?: string;
}

export async function startGeneration(p: StartParams): Promise<Job> {
  const model = p.model?.trim() || config.defaultModel;
  if (!/^veo-[a-z0-9.\-]+$/i.test(model)) {
    throw new UserError(`Invalid model "${model}". Use a Veo model name such as veo-3.1-generate-preview.`);
  }

  let operation: GenerateVideosOperation;
  try {
    operation = await ai().models.generateVideos({
      model,
      prompt: p.prompt,
      config: {
        aspectRatio: p.aspectRatio,
        ...(p.negativePrompt ? { negativePrompt: p.negativePrompt } : {}),
      },
    });
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(explainError(err));
  }
  if (!operation.name) throw new UserError("Gemini did not return an operation name. Try again.");

  const job: Job = {
    id: crypto.randomBytes(9).toString("base64url"),
    operationName: operation.name,
    prompt: p.prompt,
    negativePrompt: p.negativePrompt,
    model,
    aspectRatio: p.aspectRatio,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  addJob(job);
  return job;
}

// One poll at a time per job, so the background poller and a tool call never download twice.
const inFlight = new Map<string, Promise<Job>>();

export function refreshJob(id: string): Promise<Job> {
  const job = getJob(id);
  if (!job) return Promise.reject(new UserError(`Unknown operation_id "${id}". Use list_videos to see known ids.`));
  if (job.status !== "pending") return Promise.resolve(job);

  let p = inFlight.get(id);
  if (!p) {
    p = poll(job).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
  }
  return p;
}

async function poll(job: Job): Promise<Job> {
  const op = new GenerateVideosOperation();
  op.name = job.operationName;

  let result: GenerateVideosOperation;
  try {
    result = await ai().operations.getVideosOperation({ operation: op });
  } catch (err) {
    if (err instanceof UserError) throw err;
    // A transient polling error does not mean the generation failed; report it but keep the job pending.
    throw new UserError(`Could not check the operation right now. ${explainError(err)}`);
  }

  if (!result.done) return job;

  if (result.error) {
    return fail(job, explainOperationError(result.error));
  }

  const response = result.response;
  const video = response?.generatedVideos?.[0]?.video;
  if (!video) {
    const reasons = response?.raiMediaFilteredReasons?.filter(Boolean) ?? [];
    if (reasons.length || response?.raiMediaFilteredCount) {
      return fail(
        job,
        "BLOCKED BY SAFETY FILTERS (Xavfsizlik filtri videoni blokladi). Google's reason: " +
          (reasons.length ? reasons.join(" | ").replace(/\.?\s*$/, ".") : "no reason given.") +
          " Rephrase the prompt and try again.",
      );
    }
    return fail(job, "Generation finished but Gemini returned no video and no reason. Try again with a different prompt.");
  }

  const file = `${job.id}.mp4`;
  const dest = path.join(config.videosDir, file);
  try {
    if (video.videoBytes) {
      fs.writeFileSync(dest, Buffer.from(video.videoBytes, "base64"));
    } else if (video.uri) {
      await download(video.uri, dest);
    } else {
      return fail(job, "Gemini returned a video without a download link.");
    }
  } catch (err) {
    fs.rmSync(dest, { force: true });
    // Keep the job pending so the next check retries the download (Google keeps the file for 2 days).
    throw new UserError(`The video is ready but downloading it failed: ${err instanceof Error ? err.message : err}. Call check_video_status again.`);
  }

  return updateJob(job.id, { status: "done", file, completedAt: new Date().toISOString() })!;
}

async function download(uri: string, dest: string): Promise<void> {
  const res = await fetch(uri, { headers: { "x-goog-api-key": config.geminiApiKey }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

function fail(job: Job, error: string): Job {
  return updateJob(job.id, { status: "failed", error, completedAt: new Date().toISOString() })!;
}
