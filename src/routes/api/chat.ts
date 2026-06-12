import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { getGlorexReferences } from "@/lib/glorex-references.server";
import {
  buildGlorexImagePrompt,
  GlorexBriefingSchema,
  selectPaleta,
} from "@/lib/glorex-briefing";
import {
  getPreferencias,
  salvarPreferencia,
} from "@/lib/glorex-preferences.server";
import {
  dataUrlToInline,
  fetchBucketArtsAsInline,
  fetchUrlAsInline,
  generateAndStoreImage,
  normalizeGlorexBriefing,
  type GoogleImagePart,
} from "@/lib/image-generation.server";

const SYSTEM_PROMPT = `Você é a I.A GX, assistente do Novo Glorex Presencial. Seu único trabalho é receber o texto cru do funcionário com a programação do dia e disparar a geração da arte.

REGRA PRINCIPAL:
- Preserve 100% a ESTRUTURA, a ORDEM e o SENTIDO do texto enviado.
- NÃO reescreva, NÃO resuma, NÃO reorganize, NÃO invente nada.
- Mantenha as quebras de linha do funcionário — elas viram linhas da arte.

CORREÇÕES PERMITIDAS (e só essas):
- Moeda no formato brasileiro: "400" → "R$ 400", "1000" → "R$ 1.000", "2300" → "R$ 2.300". Se já tiver "R$", não duplique.
- Horários no formato 24h com dois pontos: "19h" → "19:00", "19h30" → "19:30", "18:30" mantém.
- Typos óbvios, pontuação e capitalização leve.

FLUXO DA CONVERSA:
- Assim que o funcionário mandar a programação, chame DIRETO a tool "gerar_arte_glorex" passando o texto já corrigido no campo "texto_briefing".
- O ÚNICO motivo para perguntar algo antes é se a mensagem estiver claramente vazia ou não for um briefing (ex.: "oi", "tudo bem?"). Nesse caso, peça em UMA linha: "Manda a programação do dia que eu já gero a arte 👍".
- PROIBIDO pedir valor de sorteio, item, evento, regra ou prêmio. Se não veio no texto, não veio — siga em frente.
- PROIBIDO pedir bola do dia, abertura, dia da semana, etc. se isso não estiver no texto. Mande o que o funcionário mandou.
- Após a tool retornar, comente em 1 frase curta que a arte foi gerada e ofereça ajustes.
- Toda arte é flyer vertical 9:16, logo "NOVO GLOREX PRESENCIAL" SEMPRE pequena no canto superior esquerdo, paleta diferente da anterior.
 - Alterne o estilo visual entre artes mais POPULARES (tons vibrantes, alegres, acessíveis) e artes mais PREMIUM (tons luxuosos, sofisticados, elegantes) a cada nova geração, variando entre esses dois perfis.
 - Se o usuário der feedback sobre como as artes devem ser DAQUI PRA FRENTE (preferência geral, não pedido pontual), chame a tool salvar_preferencia_estilo com um resumo objetivo da preferência, e confirme ao usuário em texto que vai aplicar isso nas próximas artes.
 - Se o usuário pedir algo fora do escopo, explique educadamente que você só cria artes do Novo Glorex.`;

const MAX_ARTES_GERADAS = 5;
const GOOGLE_TEXT_MODEL = "gemini-2.5-flash";

const RequestSchema = z.object({
  messages: z.array(z.any()).min(1).max(500),
  artesGeradas: z.array(z.string().url()).max(MAX_ARTES_GERADAS).optional().default([]),
});

function logEvent(event: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
  } catch {
    console.log("log-failed", event);
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
        const googleKey = process.env.GOOGLE_AI_API_KEY;
        if (!googleKey) {
          logEvent({ kind: "error", requestId, code: "missing-google-key" });
          return new Response("Configuração da I.A indisponível.", {
            status: 500,
            headers: { "X-Request-Id": requestId },
          });
        }

        let parsed: z.infer<typeof RequestSchema>;
        try {
          parsed = RequestSchema.parse(await request.json());
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          logEvent({ kind: "error", requestId, code: "bad-request", error: detail });
          return new Response(`Requisição inválida (id: ${requestId}). ${detail.slice(0, 200)}`, {
            status: 400,
            headers: { "X-Request-Id": requestId },
          });
        }

        const messages = parsed.messages as UIMessage[];
        const previousArts = (parsed.artesGeradas ?? []).slice(-MAX_ARTES_GERADAS);
        const origin = new URL(request.url).origin;

        const provider = createOpenAICompatible({
          name: "google-direct",
          baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
          headers: { Authorization: `Bearer ${googleKey}` },
        });
        const chatModel = provider(GOOGLE_TEXT_MODEL);

        logEvent({
          kind: "chat-start",
          requestId,
          messageCount: messages.length,
          previousArts: previousArts.length,
        });

        const gerarArte = tool({
          description:
            "Gera a arte promocional do Novo Glorex Presencial recebendo o briefing JÁ ESTRUTURADO (Etapa 2 do pipeline). Sempre passe TODOS os campos preenchidos com valores normalizados (R$, horários hh:mm).",
          inputSchema: GlorexBriefingSchema,
          execute: async (input, options) => {
            const abortSignal = options?.abortSignal;
            const aborted = () =>
              ({
                ok: false as const,
                category: "aborted" as const,
                error: "Geração cancelada pelo usuário.",
                requestId,
              }) as const;
            if (abortSignal?.aborted) return aborted();

            const refs = await getGlorexReferences(origin).catch((err) => {
              const detail = err instanceof Error ? err.message : String(err);
              logEvent({
                kind: "gen-fail",
                requestId,
                reason: "reference-load-failed",
                error: detail.slice(0, 300),
              });
              return null;
            });
            if (!refs) {
              return {
                ok: false as const,
                category: "references" as const,
                error:
                  "Falha interna — não consegui carregar as imagens de referência do Novo Glorex.",
                requestId,
              };
            }

            // Etapa 2 (final): rede de segurança server-side + builder determinístico.
            const briefing = normalizeGlorexBriefing(input);
            const paleta = selectPaleta(briefing.texto_briefing);
            const preferencias = await getPreferencias();
            const promptText = buildGlorexImagePrompt(briefing, paleta, preferencias);

            const parts: GoogleImagePart[] = [{ text: promptText }];

            const logoInline = dataUrlToInline(refs.logo.dataUrl);
            if (logoInline) {
              parts.push({
                inline_data: { mime_type: logoInline.mimeType, data: logoInline.data },
              });
            }

            for (const t of refs.templates) {
              const inline = dataUrlToInline(t.dataUrl);
              if (inline) {
                parts.push({
                  inline_data: { mime_type: inline.mimeType, data: inline.data },
                });
              }
            }

            // Aprendizado contínuo: últimas N artes do bucket inteiro.
            try {
              const bucketInlines = await fetchBucketArtsAsInline(undefined, abortSignal);
              for (const inline of bucketInlines) {
                parts.push({
                  inline_data: { mime_type: inline.mimeType, data: inline.data },
                });
              }
            } catch {
              /* refs do bucket são opcionais */
            }

            // Artes geradas nesta sessão do usuário.
            for (const url of previousArts) {
              if (abortSignal?.aborted) return aborted();
              const inline = await fetchUrlAsInline(url, abortSignal);
              if (inline) {
                parts.push({
                  inline_data: { mime_type: inline.mimeType, data: inline.data },
                });
              }
            }

            const result = await generateAndStoreImage({
              parts,
              requestId,
              parentSignal: abortSignal,
            });

            if (!result.ok) {
              return {
                ok: false as const,
                category: result.category,
                error: result.error,
                httpStatus: result.httpStatus,
                googleStatus: result.googleStatus,
                googleCode: result.googleCode,
                requestId: result.requestId,
              };
            }

            return {
              ok: true as const,
              imageUrl: result.imageUrl,
              requestId: result.requestId,
              resumo: {
                caracteres: briefing.texto_briefing.length,
                linhas: briefing.texto_briefing.split(/\r?\n/).filter((l) => l.trim()).length,
              },
            };
          },
          toModelOutput: ({ output }) => {
            const result = output as { ok?: boolean; error?: string; category?: string };
            return {
              type: "text" as const,
              value: result.ok
                ? "Arte do Novo Glorex gerada com sucesso. A imagem já foi entregue ao usuário na interface."
                : result.category === "aborted"
                  ? "Geração cancelada pelo usuário."
                  : `A FERRAMENTA FALHOU (categoria: ${result.category ?? "unknown"}) e NÃO gerou imagem alguma. Um card detalhado já foi mostrado ao usuário com a causa. Apenas confirme em 1 frase curta a causa: "${result.error ?? "erro desconhecido"}".`,
            };
          },
        });

        const salvarPreferenciaTool = tool({
          description:
            "Usado quando o usuário dá um feedback sobre como as artes devem ser no FUTURO (não sobre o briefing atual), ex: 'sempre coloca a logo grande', 'prefiro fundo mais escuro'. NÃO usar para pedidos pontuais de uma arte específica.",
          inputSchema: z.object({
            preferencia: z.string().min(3).max(200).describe("Resumo curto e objetivo da preferência, em português, escrito como instrução de estilo"),
          }),
          execute: async (input) => {
            await salvarPreferencia(input.preferencia);
            return { ok: true };
          },
        });

        const result = streamText({
          model: chatModel,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools: { gerar_arte_glorex: gerarArte, salvar_preferencia_estilo: salvarPreferenciaTool },
          stopWhen: stepCountIs(8),
          maxRetries: 0,
          abortSignal: request.signal,
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          headers: {
            "X-Request-Id": requestId,
            "X-Content-Type-Options": "nosniff",
          },
          onError: (error) => {
            const raw = error instanceof Error ? error.message : String(error);
            logEvent({ kind: "stream-error", requestId, error: raw });
            const isRate =
              /429|too many|rate|quota|resource.?exhausted|exhausted|overload|503|unavailable/i.test(
                raw,
              );
            if (isRate) {
              return `RATE_LIMIT: Limite de requisições do Google atingido no chat de texto. Aguarde ~1 min e tente de novo. (id: ${requestId})`;
            }
            return `${raw} (id: ${requestId})`;
          },
        });
      },
    },
  },
});
