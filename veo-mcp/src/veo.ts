import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GoogleGenAI, GenerateVideosOperation, type GoogleGenAIInteraction } from "@google/genai";
import { config } from "./config.js";
import { explainError, explainInteractionErrors, explainOperationError } from "./errors.js";
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

/** The Interactions API has no negative prompt field, so the exclusions go into the prompt text. */
function buildInput(prompt: string, negativePrompt?: string): string {
  return negativePrompt ? `${prompt}\n\nDo not include: ${negativePrompt}.` : prompt;
}

export async function startGeneration(p: StartParams): Promise<Job> {
  const model = p.model?.trim() || config.defaultModel;

  let interaction: GoogleGenAIInteraction;
  try {
    interaction = await ai().interactions.create({
      model,
      input: buildInput(p.prompt, p.negativePrompt),
      background: true,
      response_format: {
        type: "video",
        aspect_ratio: p.aspectRatio,
        duration: `${config.durationSeconds}s`,
        delivery: "uri",
      },
    });
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(explainError(err));
  }
  if (!interaction.id) throw new UserError("Gemini did not return an interaction id. Try again.");

  const job: Job = {
    id: crypto.randomBytes(9).toString("base64url"),
    api: "interactions",
    operationName: interaction.id,
    prompt: p.prompt,
    negativePrompt: p.negativePrompt,
    model,
    aspectRatio: p.aspectRatio,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  addJob(job);
  // The background job can fail instantly (e.g. quota); record that right away.
  if (interaction.status && interaction.status !== "in_progress" && interaction.status !== "queued") {
    return finishInteraction(job, interaction);
  }
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
    p = (job.api === "interactions" ? pollInteraction(job) : pollLegacyVeo(job)).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
  }
  return p;
}

async function pollInteraction(job: Job): Promise<Job> {
  let interaction: GoogleGenAIInteraction;
  try {
    interaction = await ai().interactions.get(job.operationName);
  } catch (err) {
    if (err instanceof UserError) throw err;
    // A transient polling error does not mean the generation failed; report it but keep the job pending.
    throw new UserError(`Could not check the generation right now. ${explainError(err)}`);
  }
  if (interaction.status === "in_progress" || interaction.status === "queued") return job;
  return finishInteraction(job, interaction);
}

async function finishInteraction(job: Job, interaction: GoogleGenAIInteraction): Promise<Job> {
  if (interaction.status !== "completed") {
    return fail(job, explainInteractionErrors(interaction.status, interaction.errors));
  }
  // The video is normally in output_video; fall back to the model_output steps.
  let video = interaction.output_video;
  for (const step of interaction.steps ?? []) {
    if (video) break;
    if (step.type === "model_output") video = step.content?.find((c) => c.type === "video") as typeof video;
  }
  if (!video?.uri && !video?.data) {
    const text = interaction.output_text?.trim();
    return fail(
      job,
      "Generation finished but Gemini returned no video." + (text ? ` Model said: "${text.slice(0, 500)}"` : "") +
        " This usually means the prompt was refused by safety filters — rephrase it and try again.",
    );
  }
  return saveVideo(job, video);
}

/** Polls a generation started with the old Veo predictLongRunning API (jobs created before the migration). */
async function pollLegacyVeo(job: Job): Promise<Job> {
  const op = new GenerateVideosOperation();
  op.name = job.operationName;
  let result: GenerateVideosOperation;
  try {
    result = await ai().operations.getVideosOperation({ operation: op });
  } catch (err) {
    return fail(job, `This old Veo job can no longer be checked. ${explainError(err)}`);
  }
  if (!result.done) return job;
  if (result.error) return fail(job, explainOperationError(result.error));
  const video = result.response?.generatedVideos?.[0]?.video;
  if (!video?.uri && !video?.videoBytes) {
    const reasons = result.response?.raiMediaFilteredReasons?.filter(Boolean) ?? [];
    return fail(job, "BLOCKED BY SAFETY FILTERS. Google's reason: " + (reasons.join(" | ") || "no reason given."));
  }
  return saveVideo(job, { uri: video.uri, data: video.videoBytes });
}

async function saveVideo(job: Job, video: { uri?: string; data?: string }): Promise<Job> {
  const file = `${job.id}.mp4`;
  const dest = path.join(config.videosDir, file);
  try {
    if (video.data) {
      fs.writeFileSync(dest, Buffer.from(video.data, "base64"));
    } else {
      await download(video.uri!, dest);
    }
  } catch (err) {
    fs.rmSync(dest, { force: true });
    // Keep the job pending so the next check retries the download.
    throw new UserError(`The video is ready but downloading it failed: ${err instanceof Error ? err.message : err}. Call check_video_status again.`);
  }
  return updateJob(job.id, { status: "done", file, completedAt: new Date().toISOString() })!;
}

async function download(uri: string, dest: string): Promise<void> {
  // A bare resource name like "files/abc" is downloaded through the Files API.
  if (!/^https?:\/\//.test(uri)) {
    const base = (config.geminiBaseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    uri = `${base}/v1beta/${uri.replace(/^\/+/, "")}:download?alt=media`;
  }
  const res = await fetch(uri, { headers: { "x-goog-api-key": config.geminiApiKey }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

function fail(job: Job, error: string): Job {
  return updateJob(job.id, { status: "failed", error, completedAt: new Date().toISOString() })!;
}
