// Rota server-side dedicada à geração de imagens.
// Frontend POST -> { prompt, references? } -> Gemini -> Supabase Storage -> { success, imageUrl }
//
// Segredos exigidos (já configurados):
// - GOOGLE_AI_API_KEY           (obrigatório)
// - SUPABASE_URL                (obrigatório)
// - SUPABASE_SERVICE_ROLE_KEY   (obrigatório)
// - GOOGLE_IMAGE_MODEL          (opcional, default = gemini-3.1-flash-image-preview)
// - GOOGLE_IMAGE_FALLBACK_MODEL (opcional, default = gemini-2.5-flash-image)
// - LOVABLE_API_KEY             (opcional, fallback final via Lovable AI Gateway)
//
// Bucket exigido: glorex-generated-images (criado por migration).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  fetchBucketArtsAsInline,
  fetchUrlAsInline,
  generateAndStoreImage,
  normalizeBriefingString,
  normalizeGlorexBriefing,
  type GoogleImagePart,
} from "@/lib/image-generation.server";
import { getGlorexReferences } from "@/lib/glorex-references.server";
import {
  buildGlorexImagePrompt,
  GlorexBriefingSchema,
  selectPaleta,
} from "@/lib/glorex-briefing";

const RequestSchema = z.union([
  z.object({
    prompt: z.string().min(1).max(8000),
    references: z.array(z.string().url()).max(10).optional().default([]),
    includeBrandReferences: z.boolean().optional().default(true),
  }),
  z.object({
    briefing: GlorexBriefingSchema,
    references: z.array(z.string().url()).max(10).optional().default([]),
    includeBrandReferences: z.boolean().optional().default(true),
  }),
]);

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

        let body: z.infer<typeof RequestSchema>;
        try {
          body = RequestSchema.parse(await request.json());
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          return Response.json(
            { success: false, error: `Requisição inválida: ${detail.slice(0, 200)}`, category: "validation" },
            { status: 400, headers: { "X-Request-Id": requestId } },
          );
        }

        const origin = new URL(request.url).origin;
        const promptText =
          "briefing" in body
            ? buildGlorexImagePrompt(normalizeGlorexBriefing(body.briefing), selectPaleta(normalizeGlorexBriefing(body.briefing).texto_briefing))
            : normalizeBriefingString(body.prompt);
        const parts: GoogleImagePart[] = [{ text: promptText }];

        if (body.includeBrandReferences) {
          try {
            const refs = await getGlorexReferences(origin);
            const logoMatch = refs.logo.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (logoMatch) {
              parts.push({ inline_data: { mime_type: logoMatch[1], data: logoMatch[2] } });
            }
            for (const t of refs.templates) {
              const m = t.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
            }
          } catch (err) {
            return Response.json(
              {
                success: false,
                error: `Falha ao carregar referências da marca: ${err instanceof Error ? err.message : String(err)}`,
                category: "references",
              },
              { status: 500, headers: { "X-Request-Id": requestId } },
            );
          }
        }

        // Aprendizado contínuo: últimas N artes do bucket inteiro.
        try {
          const bucketInlines = await fetchBucketArtsAsInline(undefined, request.signal);
          for (const inline of bucketInlines) {
            parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.data } });
          }
        } catch {
          /* opcional */
        }

        for (const url of body.references) {
          const inline = await fetchUrlAsInline(url, request.signal);
          if (inline) {
            parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.data } });
          }
        }

        const result = await generateAndStoreImage({
          parts,
          requestId,
          parentSignal: request.signal,
        });

        if (!result.ok) {
          const status =
            result.category === "aborted"
              ? 499
              : result.category === "quota"
                ? 429
                : result.category === "auth" || result.category === "permission"
                  ? 401
                  : result.category === "bad_request"
                    ? 400
                    : result.category === "upstream" || result.category === "network"
                      ? 502
                      : 500;
          return Response.json(
            {
              success: false,
              error: result.error,
              category: result.category,
              requestId: result.requestId,
            },
            { status, headers: { "X-Request-Id": requestId } },
          );
        }

        return Response.json(
          {
            success: true,
            imageUrl: result.imageUrl,
            path: result.path,
            requestId: result.requestId,
          },
          { status: 200, headers: { "X-Request-Id": requestId } },
        );
      },
    },
  },
});
