// Server-only: chama o Google Gemini (Nano Banana 2), faz upload no
// Supabase Storage (bucket "glorex-generated-images") e devolve apenas
// a URL pública. Centraliza retries, fallback (Lovable Gateway) e logs.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const BUCKET = "glorex-generated-images";
const TIMEOUT_MS = 150_000;

// Modelo configurável via env. Default = Nano Banana 2 Flash.
const IMAGE_MODEL = process.env.GOOGLE_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
const FALLBACK_MODEL = process.env.GOOGLE_IMAGE_FALLBACK_MODEL || "gemini-2.5-flash-image";

export type GoogleImagePart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type ErrorCategory =
  | "validation"
  | "quota"
  | "auth"
  | "permission"
  | "model_not_found"
  | "bad_request"
  | "upstream"
  | "safety"
  | "timeout"
  | "network"
  | "storage"
  | "aborted"
  | "references"
  | "unknown";

export type GenerateImageResult =
  | { ok: true; imageUrl: string; path: string; requestId: string }
  | {
      ok: false;
      category: ErrorCategory;
      error: string;
      httpStatus?: number;
      googleStatus?: string;
      googleCode?: string | number;
      requestId: string;
    };

function logEvent(event: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
  } catch {
    console.log("log-failed", event);
  }
}

export function dataUrlToInline(
  dataUrl: string,
): { mimeType: string; data: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

// Baixa uma imagem pública (URL) e devolve em base64 para inlinear na chamada do Google.
export async function fetchUrlAsInline(
  url: string,
  signal?: AbortSignal,
): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { mimeType: mime, data: btoa(bin) };
  } catch {
    return null;
  }
}

async function callGoogleOnce(opts: {
  apiKey: string;
  parts: GoogleImagePart[];
  requestId: string;
  model: string;
  attempt: number;
  parentSignal?: AbortSignal;
}): Promise<Response> {
  const { apiKey, parts, requestId, model, attempt, parentSignal } = opts;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", onAbort, { once: true });
  }
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          imageConfig: { aspectRatio: "9:16" },
        },
      }),
      signal: controller.signal,
    });
    logEvent({
      kind: "google-image",
      requestId,
      model,
      attempt,
      status: res.status,
      durationMs: Date.now() - startedAt,
    });
    return res;
  } finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener("abort", onAbort);
  }
}

async function callGoogleWithRetry(opts: {
  apiKey: string;
  parts: GoogleImagePart[];
  requestId: string;
  parentSignal?: AbortSignal;
}): Promise<Response> {
  const { apiKey, parts, requestId, parentSignal } = opts;
  const models = [IMAGE_MODEL, IMAGE_MODEL, FALLBACK_MODEL, IMAGE_MODEL, FALLBACK_MODEL];
  let lastRes: Response | null = null;
  let lastErr: unknown = null;
  for (let i = 0; i < models.length; i++) {
    if (parentSignal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await callGoogleOnce({
        apiKey,
        parts,
        requestId,
        model: models[i],
        attempt: i + 1,
        parentSignal,
      });
      let retriable = res.status >= 500 || res.status === 429;
      if (!retriable && res.status === 400) {
        const body = await res.clone().text().catch(() => "");
        if (/unable to process input image/i.test(body)) {
          retriable = true;
          lastRes = new Response(body, { status: res.status, headers: res.headers });
        }
      }
      if (retriable) {
        if (!lastRes) lastRes = res;
        if (i < models.length - 1) {
          const delay = Math.min(8000, 1200 * Math.pow(1.7, i)) + Math.random() * 600;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return lastRes;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (parentSignal?.aborted) throw err;
      logEvent({
        kind: "google-image-throw",
        requestId,
        model: models[i],
        attempt: i + 1,
        error: err instanceof Error ? err.message : String(err),
      });
      if (i < models.length - 1) {
        const delay = Math.min(8000, 1200 * Math.pow(1.7, i)) + Math.random() * 600;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  if (lastRes) return lastRes;
  throw lastErr ?? new Error("Falha desconhecida na geração de imagem.");
}

async function callLovableGateway(opts: {
  parts: GoogleImagePart[];
  requestId: string;
  parentSignal?: AbortSignal;
}): Promise<{ ok: boolean; mimeType?: string; data?: string; status: number; error?: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) return { ok: false, status: 500, error: "LOVABLE_API_KEY ausente" };

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [];
  for (const p of opts.parts) {
    if ("text" in p) content.push({ type: "text", text: p.text });
    else
      content.push({
        type: "image_url",
        image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` },
      });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (opts.parentSignal) {
    if (opts.parentSignal.aborted) controller.abort();
    else opts.parentSignal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Request-Id": opts.requestId,
      },
      body: JSON.stringify({
        model: `google/${IMAGE_MODEL}`,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
      signal: controller.signal,
    });
    logEvent({ kind: "lovable-gateway-image", requestId: opts.requestId, status: res.status });
    if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
    const data = (await res.json()) as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    };
    const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) return { ok: false, status: 502, error: "Sem imagem na resposta da gateway" };
    const m = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return { ok: false, status: 502, error: "Formato inesperado da gateway" };
    return { ok: true, mimeType: m[1], data: m[2], status: 200 };
  } finally {
    clearTimeout(timer);
    if (opts.parentSignal) opts.parentSignal.removeEventListener("abort", onAbort);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function mimeToExt(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

async function uploadToStorage(opts: {
  data: string;
  mimeType: string;
  requestId: string;
}): Promise<{ ok: true; url: string; path: string } | { ok: false; error: string }> {
  try {
    const bytes = base64ToBytes(opts.data);
    const ext = mimeToExt(opts.mimeType);
    const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: opts.mimeType,
      cacheControl: "31536000, immutable",
      upsert: false,
    });
    if (error) {
      logEvent({ kind: "storage-upload-fail", requestId: opts.requestId, error: error.message });
      return { ok: false, error: error.message };
    }
    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    logEvent({ kind: "storage-upload-ok", requestId: opts.requestId, path });
    return { ok: true, url: data.publicUrl, path };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function generateAndStoreImage(opts: {
  parts: GoogleImagePart[];
  requestId: string;
  parentSignal?: AbortSignal;
}): Promise<GenerateImageResult> {
  const { parts, requestId, parentSignal } = opts;
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      category: "auth",
      error: "GOOGLE_AI_API_KEY não configurada no servidor.",
      requestId,
    };
  }

  const aborted = (): GenerateImageResult => ({
    ok: false,
    category: "aborted",
    error: "Geração cancelada pelo usuário.",
    requestId,
  });

  try {
    if (parentSignal?.aborted) return aborted();
    const res = await callGoogleWithRetry({ apiKey, parts, requestId, parentSignal });
    if (parentSignal?.aborted) return aborted();

    let mimeType: string | undefined;
    let data: string | undefined;

    if (!res.ok && (res.status >= 500 || res.status === 429)) {
      logEvent({ kind: "google-fallback-to-gateway", requestId, googleStatus: res.status });
      const gw = await callLovableGateway({ parts, requestId, parentSignal });
      if (parentSignal?.aborted) return aborted();
      if (gw.ok && gw.data && gw.mimeType) {
        mimeType = gw.mimeType;
        data = gw.data;
      }
    }

    if (!mimeType || !data) {
      if (!res.ok) {
        const text = await res.text();
        let googleStatus: string | undefined;
        let googleMessage: string | undefined;
        let googleCode: string | number | undefined;
        try {
          const parsed = JSON.parse(text) as {
            error?: { code?: number | string; message?: string; status?: string };
          };
          googleStatus = parsed.error?.status;
          googleMessage = parsed.error?.message;
          googleCode = parsed.error?.code;
        } catch {
          /* not JSON */
        }
        let category: ErrorCategory;
        let userMsg: string;
        if (res.status === 429) {
          category = "quota";
          userMsg = `Cota gratuita do Google atingida${googleMessage ? `: ${googleMessage}` : ""}. Tente em algumas horas.`;
        } else if (res.status === 401) {
          category = "auth";
          userMsg = `Chave do Google inválida${googleMessage ? `: ${googleMessage}` : ""}.`;
        } else if (res.status === 403) {
          category = "permission";
          userMsg = `Sem permissão para o modelo ${IMAGE_MODEL}${googleMessage ? `: ${googleMessage}` : ""}.`;
        } else if (res.status === 404) {
          category = "model_not_found";
          userMsg = `Modelo ${IMAGE_MODEL} não encontrado${googleMessage ? `: ${googleMessage}` : ""}.`;
        } else if (res.status === 400) {
          category = "bad_request";
          userMsg =
            googleMessage && /unable to process input image/i.test(googleMessage)
              ? `O Google rejeitou as imagens de referência. Geralmente é transitório — tente de novo.`
              : `Requisição rejeitada pelo Google${googleMessage ? `: ${googleMessage}` : ""}.`;
        } else if (res.status >= 500) {
          category = "upstream";
          userMsg = `Serviço de imagem do Google instável (${res.status})${googleMessage ? ` — ${googleMessage}` : ""}.`;
        } else {
          category = "unknown";
          userMsg = `Falha ao gerar imagem (HTTP ${res.status})${googleMessage ? `: ${googleMessage}` : ""}.`;
        }
        logEvent({
          kind: "gen-fail",
          requestId,
          status: res.status,
          googleStatus,
          googleCode,
          googleMessage: googleMessage?.slice(0, 300),
        });
        return {
          ok: false,
          category,
          error: userMsg,
          httpStatus: res.status,
          googleStatus,
          googleCode,
          requestId,
        };
      }

      const json = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: { mimeType?: string; data?: string };
              inline_data?: { mime_type?: string; data?: string };
              text?: string;
            }>;
          };
        }>;
      };
      const outParts = json.candidates?.[0]?.content?.parts ?? [];
      for (const p of outParts) {
        const inline = (p.inlineData ?? p.inline_data) as
          | { mimeType?: string; mime_type?: string; data?: string }
          | undefined;
        const mt = inline?.mimeType ?? inline?.mime_type;
        const dt = inline?.data;
        if (mt && dt) {
          mimeType = mt;
          data = dt;
          break;
        }
      }
      if (!mimeType || !data) {
        const textOut = outParts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 300);
        logEvent({ kind: "gen-fail", requestId, reason: "no-image-in-response", modelText: textOut });
        return {
          ok: false,
          category: "safety",
          error: `O modelo respondeu mas não devolveu imagem${textOut ? ` (motivo: ${textOut})` : ""}. Pode ser bloqueio de segurança — tente reformular.`,
          requestId,
        };
      }
    }

    if (parentSignal?.aborted) return aborted();

    const uploaded = await uploadToStorage({ data, mimeType, requestId });
    if (!uploaded.ok) {
      return {
        ok: false,
        category: "storage",
        error: `Falha ao salvar a imagem no Storage: ${uploaded.error}`,
        requestId,
      };
    }
    logEvent({ kind: "gen-ok", requestId, url: uploaded.url });
    return { ok: true, imageUrl: uploaded.url, path: uploaded.path, requestId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || errMsg.includes("aborted"));
    if (isAbort && parentSignal?.aborted) {
      logEvent({ kind: "gen-aborted", requestId });
      return aborted();
    }
    logEvent({ kind: "gen-exception", requestId, error: errMsg });
    return {
      ok: false,
      category: isAbort ? "timeout" : "network",
      error: isAbort
        ? `Timeout — geração demorou mais que ${Math.round(TIMEOUT_MS / 1000)}s.`
        : `Falha de rede ao chamar o Google: ${errMsg.slice(0, 120)}.`,
      requestId,
    };
  }
}
