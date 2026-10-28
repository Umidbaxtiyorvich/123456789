import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type JobStatus = "pending" | "done" | "failed";

export interface Job {
  id: string;
  /** "interactions" for Gemini Interactions API jobs; absent for old Veo predictLongRunning jobs. */
  api?: "interactions";
  operationName: string; // interaction id (or Veo operation name for old jobs)
  prompt: string;
  negativePrompt?: string;
  model: string;
  aspectRatio: string;
  status: JobStatus;
  error?: string;
  file?: string; // file name inside videosDir
  createdAt: string;
  completedAt?: string;
}

let jobs: Job[] = [];

export function initStore(): void {
  fs.mkdirSync(config.videosDir, { recursive: true });
  try {
    jobs = JSON.parse(fs.readFileSync(config.dbFile, "utf8"));
  } catch {
    jobs = [];
  }
}

function save(): void {
  const tmp = `${config.dbFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, config.dbFile);
}

export function addJob(job: Job): void {
  jobs.push(job);
  save();
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const job = jobs.find((j) => j.id === id);
  if (!job) return undefined;
  Object.assign(job, patch);
  save();
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.find((j) => j.id === id);
}

export function listJobs(): Job[] {
  return [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function videoUrl(job: Job): string | undefined {
  return job.file ? `${config.publicBaseUrl}/videos/${job.file}` : undefined;
}

/** Deletes videos and job records older than the retention period. */
export function cleanupOld(): void {
  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  const keep: Job[] = [];
  for (const job of jobs) {
    if (new Date(job.createdAt).getTime() >= cutoff) {
      keep.push(job);
      continue;
    }
    if (job.file) fs.rmSync(path.join(config.videosDir, job.file), { force: true });
  }
  // Also remove stray files that no record points to.
  const known = new Set(keep.map((j) => j.file).filter(Boolean));
  for (const name of fs.readdirSync(config.videosDir)) {
    const full = path.join(config.videosDir, name);
    if (!known.has(name) && fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
  }
  if (keep.length !== jobs.length) {
    jobs = keep;
    save();
  }
}
