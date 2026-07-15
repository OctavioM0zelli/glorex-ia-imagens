import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { selectPaleta, buildGlorexImagePrompt, GlorexBriefingSchema } from "@/lib/glorex-briefing";
import { getPreferencias } from "@/lib/glorex-preferences.server";
import { getGlorexReferences } from "@/lib/glorex-references.server";
import {
  dataUrlToInline,
  fetchBucketArtsAsInline,
  generateAndStoreImage,
  normalizeGlorexBriefing,
  type GoogleImagePart,
} from "@/lib/image-generation.server";

export default defineTool({
  name: "gerar_arte_glorex",
  title: "Gerar arte do Novo Glorex",
  description:
    "Gera um flyer promocional vertical (9:16) do Novo Glorex Presencial a partir do briefing do dia. Recebe o texto cru da programação (horários, prêmios, dia da semana, bola do dia, regras) e retorna a URL pública da imagem gerada.",
  inputSchema: {
    texto_briefing: z
      .string()
      .min(3)
      .describe(
        "Texto completo da programação do dia, exatamente como o funcionário escreveria (com quebras de linha). Use R$ e horários hh:mm.",
      ),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async ({ texto_briefing }) => {
    try {
      const origin = process.env.APP_PUBLIC_ORIGIN ?? "https://glorex-ia-imagens.lovable.app";
      const briefing = normalizeGlorexBriefing(
        GlorexBriefingSchema.parse({ texto_briefing }),
      );
      const paleta = selectPaleta(briefing.texto_briefing);
      const preferencias = await getPreferencias().catch(() => []);
      const promptText = buildGlorexImagePrompt(briefing, paleta, preferencias);

      const refs = await getGlorexReferences(origin);
      const parts: GoogleImagePart[] = [{ text: promptText }];
      const logoInline = dataUrlToInline(refs.logo.dataUrl);
      if (logoInline)
        parts.push({ inline_data: { mime_type: logoInline.mimeType, data: logoInline.data } });
      for (const t of refs.templates) {
        const inline = dataUrlToInline(t.dataUrl);
        if (inline)
          parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.data } });
      }
      try {
        const bucketInlines = await fetchBucketArtsAsInline();
        for (const inline of bucketInlines) {
          parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.data } });
        }
      } catch {
        /* refs opcionais */
      }

      const result = await generateAndStoreImage({ parts, requestId: crypto.randomUUID() });
      if (!result.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Falha ao gerar a arte (${result.category}): ${result.error}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Arte gerada com sucesso.\nURL: ${result.imageUrl}`,
          },
        ],
        structuredContent: { imageUrl: result.imageUrl, requestId: result.requestId },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Erro interno: ${msg}` }],
        isError: true,
      };
    }
  },
});
