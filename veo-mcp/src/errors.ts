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

/** Explains a failed Interactions API job ({ status, errors: [{ code, message }] }). */
export function explainInteractionErrors(status: string | undefined, errors?: Array<{ code?: string; message?: string }>): string {
  const list = errors?.filter((e) => e.code || e.message) ?? [];
  if (!list.length) return `Generation ended with status "${status ?? "unknown"}" and no error details. Try again.`;
  const codeStatus: Record<string, number> = { RESOURCE_EXHAUSTED: 429, PERMISSION_DENIED: 403, NOT_FOUND: 404, INVALID_ARGUMENT: 400, UNAUTHENTICATED: 401, INTERNAL: 500, UNAVAILABLE: 503 };
  const first = list[0];
  const raw = list.map((e) => [e.code, e.message].filter(Boolean).join(": ")).join(" | ");
  return explain(first.code ? codeStatus[first.code] : undefined, raw);
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
  if (
    msg.includes("billing") ||
    msg.includes("paid tier") ||
    (msg.includes("free tier") && (msg.includes("not available") || msg.includes("limit: 0")))
  ) {
    return (
      "BILLING NOT ENABLED: Video generation has no free quota (Free Tier limit is 0) — it needs a Gemini API key from a Google Cloud project with billing enabled (paid tier). " +
      "Open https://aistudio.google.com → Settings → Billing / Usage and set up billing for the project. " +
      "(Video yaratish faqat billing yoqilgan loyihada ishlaydi.)" + detail
    );
  }
  if (status === 429 || msg.includes("resource_exhausted") || msg.includes("quota")) {
    return (
      "QUOTA EXCEEDED: the rate limit or daily quota for this model is used up. Wait a few minutes (or until the daily reset), " +
      "or raise limits at https://aistudio.google.com/usage. If this happens on the very first request, the key is probably on the Free Tier: " +
      "enable billing for its project. " +
      "(Kvota tugadi — biroz kuting; birinchi so'rovdayoq chiqsa, billingni yoqing.)" + detail
    );
  }
  if (msg.includes("safety") || msg.includes("blocked") || msg.includes("responsible ai") || msg.includes("violat") || msg.includes("prohibited")) {
    return (
      "BLOCKED BY SAFETY FILTERS: Google rejected the prompt. Rephrase it — avoid real people/celebrities, violence, " +
      "copyrighted characters or other sensitive content. (Xavfsizlik filtri prompt'ni blokladi — uni o'zgartiring.)" + detail
    );
  }
  if (status === 404 || (msg.includes("not found") && msg.includes("model"))) {
    return "MODEL NOT FOUND: this model name is not available for your API key. Use gemini-omni-1.1-flash (or gemini-omni-flash-preview)." + detail;
  }
  if (status === 403 || msg.includes("permission_denied")) {
    return (
      "PERMISSION DENIED: this API key cannot use this model (the Generative Language API may be disabled, the key may be restricted, " +
      "or video generation is not available in your region / for your account)." + detail
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
