import path from "node:path";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function detectBaseUrl(port: number): string {
  if (process.env.PUBLIC_BASE_URL) return trimSlash(process.env.PUBLIC_BASE_URL);
  // Render and Railway expose the public URL automatically.
  if (process.env.RENDER_EXTERNAL_URL) return trimSlash(process.env.RENDER_EXTERNAL_URL);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${port}`;
}

const port = Number(process.env.PORT) || 3000;
const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export const config = {
  port,
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
  // Only used by tests to point the SDK at a mock server.
  geminiBaseUrl: process.env.GEMINI_BASE_URL?.trim() || undefined,
  accessToken: process.env.ACCESS_TOKEN?.trim() || "",
  publicBaseUrl: detectBaseUrl(port),
  dataDir,
  videosDir: path.join(dataDir, "videos"),
  dbFile: path.join(dataDir, "db.json"),
  retentionDays: Number(process.env.RETENTION_DAYS) || 7,
  defaultModel: process.env.DEFAULT_VIDEO_MODEL?.trim() || process.env.DEFAULT_VEO_MODEL?.trim() || "gemini-omni-1.1-flash",
  durationSeconds: Number(process.env.VIDEO_DURATION_SECONDS) || 8,
};

/** Video models served by the Gemini Interactions API (both generate audio and dialogue natively). */
export const MODELS: Record<string, string> = {
  "gemini-omni-1.1-flash": "Gemini Omni 1.1 Flash — barqaror, ovoz va dialog bilan (standart)",
  "gemini-omni-flash-preview": "Gemini Omni Flash Preview — sinov versiyasi, ovoz bilan",
};

export function validateConfig(): void {
  if (!config.accessToken || config.accessToken.length < 16) {
    console.error(
      "ACCESS_TOKEN is missing or shorter than 16 characters. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\"",
    );
    process.exit(1);
  }
  if (!config.geminiApiKey) {
    console.warn("WARNING: GEMINI_API_KEY is not set — video tools will return an error until it is.");
  }
}
