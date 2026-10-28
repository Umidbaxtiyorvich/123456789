import { ApiError } from "@google/genai";

/** Turns a Gemini API error into a short, readable explanation (English + Uzbek). */
export function explainError(err: unknown): string {
  const status = err instanceof ApiError ? err.status : undefined;
  let raw = err instanceof Error ? err.message : String(err);
  // ApiError messages are often the raw JSON body: {"error":{"code":429,"message":"...","status":"..."}}
  try {
    const body = JSON.parse(raw.slice(raw.indexOf("{")));
    if (body?.error?.message) raw = [body.error.status, body.error.message].filter(Boolean).join(": ");
  } catch {
    // not JSON, keep as is
  }
  return explain(status, raw);
}

/** Same as explainError but for an `operation.error` object ({ code, message }). */
export function explainOperationError(error: Record<string, unknown>): string {
  const code = typeof error.code === "number" ? error.code : undefined;
  const message = typeof error.message === "string" ? error.message : JSON.stringify(error);
  return explain(grpcToHttp(code), message);
}

function grpcToHttp(code?: number): number | undefined {
  // google.rpc.Code -> HTTP status
  const map: Record<number, number> = { 3: 400, 5: 404, 7: 403, 8: 429, 9: 400, 13: 500, 14: 503, 16: 401 };
  return code === undefined ? undefined : map[code] ?? code;
}

function explain(status: number | undefined, raw: string): string {
  const msg = raw.toLowerCase();
  const detail = `\n\nOriginal error: ${raw}`;

  if (msg.includes("api key not valid") || msg.includes("api_key_invalid") || msg.includes("api key expired") || status === 401) {
    return (
      "INVALID API KEY: Gemini rejected GEMINI_API_KEY. Create a new key at https://aistudio.google.com/apikey and update the environment variable. " +
      "(API kalit noto'g'ri — aistudio.google.com/apikey dan yangi kalit oling.)" + detail
    );
  }
  if (msg.includes("billing") || msg.includes("paid tier") || (msg.includes("free tier") && msg.includes("not available"))) {
    return (
      "BILLING NOT ENABLED: Veo requires a Gemini API key from a Google Cloud project with billing enabled (paid tier). " +
      "Open https://aistudio.google.com → Settings → Billing / Usage and set up billing for the project. " +
      "(Veo faqat billing yoqilgan loyihada ishlaydi.)" + detail
    );
  }
  if (status === 429 || msg.includes("resource_exhausted") || msg.includes("quota")) {
    return (
      "QUOTA EXCEEDED: the rate limit or daily quota for this Veo model is used up. Wait a few minutes (or until the daily reset), " +
      "try a different model (e.g. a -fast- one) or raise limits at https://aistudio.google.com/usage. " +
      "(Kvota tugadi — biroz kuting yoki boshqa model tanlang.)" + detail
    );
  }
  if (msg.includes("safety") || msg.includes("blocked") || msg.includes("responsible ai") || msg.includes("violat") || msg.includes("prohibited")) {
    return (
      "BLOCKED BY SAFETY FILTERS: Google rejected the prompt. Rephrase it — avoid real people/celebrities, violence, " +
      "copyrighted characters or other sensitive content. (Xavfsizlik filtri prompt'ni blokladi — uni o'zgartiring.)" + detail
    );
  }
  if (status === 404 || (msg.includes("not found") && msg.includes("model"))) {
    return "MODEL NOT FOUND: this Veo model name is not available for your API key. Try veo-3.1-generate-preview or veo-3.1-fast-generate-preview." + detail;
  }
  if (status === 403 || msg.includes("permission_denied")) {
    return (
      "PERMISSION DENIED: this API key cannot use Veo (the Generative Language API may be disabled, the key may be restricted, " +
      "or Veo is not available in your region / for your account)." + detail
    );
  }
  if (status === 400 || msg.includes("invalid_argument")) {
    return "INVALID REQUEST: Gemini rejected one of the parameters (prompt, aspect ratio or model combination)." + detail;
  }
  if (status !== undefined && status >= 500) {
    return "GOOGLE SERVER ERROR: Gemini is temporarily unavailable. Try again in a minute." + detail;
  }
  return `ERROR: ${raw}`;
}
