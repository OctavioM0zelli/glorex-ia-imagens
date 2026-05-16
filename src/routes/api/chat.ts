import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { getGlorexReferences } from "@/lib/glorex-references.server";

const SYSTEM_PROMPT = `Você é a I.A GX, assistente do Novo Glorex Presencial especializada em criar artes promocionais para bingos e sorteios.

Seu trabalho:
- Conversar em português brasileiro, de forma direta, simpática e objetiva.
- Coletar com o usuário os dados da arte: dia da semana e data, horário de abertura, jogadas (horário + valor de cada série), bola do dia, prêmios extras (kit churrasco, airfryer, frigobar, picanha etc.) e o slogan final.
- Quando tiver dados suficientes, faça um resumo curto e CHAME a tool "gerar_arte_glorex" passando todas as informações estruturadas. Não invente dados que o usuário não forneceu.
- Após a tool retornar, comente brevemente que a arte foi gerada e ofereça ajustes (mudar paleta, refazer com outra bola do dia, adicionar mais jogadas etc.).
- Toda arte é um flyer vertical e SEMPRE inclui a logo "NOVO GLOREX PRESENCIAL".
- Cada arte gerada deve ser ÚNICA, variando paleta de fundo, disposição dos blocos e elementos decorativos — assim como nos templates de referência (que alternam fundos pretos, vermelhos, azuis, dourados, brancos etc.). Nunca repetir uma arte anterior.
- Se o usuário pedir algo fora do escopo, explique educadamente que você só cria artes do Novo Glorex.`;

// Limites de payload para evitar payloads gigantes que quebram o gateway
const MAX_ARTES_GERADAS = 5;
const MAX_ART_DATAURL_LENGTH = 900_000; // margem segura abaixo do limite do gateway
const GATEWAY_TIMEOUT_MS = 60_000;

const RequestSchema = z.object({
  messages: z.array(z.any()).min(1).max(500),
  artesGeradas: z
    // Não rejeita a requisição inteira se uma arte antiga vier grande demais;
    // filtramos abaixo para manter o chat funcionando.
    .array(z.string())
    .max(MAX_ARTES_GERADAS)
    .optional()
    .default([]),
});

function logEvent(event: Record<string, unknown>) {
  // Log estruturado JSON — facilita filtro em stack_modern--server-function-logs
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
  } catch {
    console.log("log-failed", event);
  }
}

async function fetchGatewayWithRetry(opts: {
  apiKey: string;
  body: unknown;
  requestId: string;
}): Promise<Response> {
  const { apiKey, body, requestId } = opts;
  const maxAttempts = 3;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
          "X-Request-Id": requestId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      logEvent({
        kind: "gateway",
        requestId,
        attempt,
        status: res.status,
        durationMs: Date.now() - startedAt,
      });
      // Retry apenas em 429 e 5xx
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
          continue;
        }
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      logEvent({
        kind: "gateway-error",
        requestId,
        attempt,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("Falha desconhecida ao chamar o gateway");
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          logEvent({ kind: "error", requestId, code: "missing-api-key" });
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
          logEvent({
            kind: "error",
            requestId,
            code: "bad-request",
            error: detail,
          });
          return new Response(`Requisição inválida (id: ${requestId}). ${detail.slice(0, 200)}`, {
            status: 400,
            headers: { "X-Request-Id": requestId },
          });
        }

        const messages = parsed.messages as UIMessage[];
        const artesGeradas = (parsed.artesGeradas ?? []).filter(
          (arte) => arte.length <= MAX_ART_DATAURL_LENGTH,
        );
        const origin = new URL(request.url).origin;
        const gateway = createLovableAiGatewayProvider(apiKey);
        const chatModel = gateway("google/gemini-3-flash-preview");

        // Usa até as últimas N artes como referência de estilo (variação)
        const previousArts = artesGeradas.slice(-MAX_ARTES_GERADAS);

        logEvent({
          kind: "chat-start",
          requestId,
          messageCount: messages.length,
          receivedArts: parsed.artesGeradas?.length ?? 0,
          acceptedArts: previousArts.length,
          previousArtsBytes: previousArts.reduce((acc, a) => acc + a.length, 0),
        });

        const gerarArte = tool({
          description:
            "Gera a arte promocional do Novo Glorex Presencial usando Nano Banana 2, com fundo branco, detalhes laranja-amarelados e a logo Novo Glorex. Use quando o usuário tiver fornecido dados suficientes.",
          inputSchema: z.object({
            dia: z.string().describe("Dia da semana e/ou data, ex: 'Sexta — dia 15'."),
            abertura: z.string().describe("Horário de abertura, ex: '18:30'."),
            jogadas: z
              .array(
                z.object({
                  horario: z.string().describe("Horário, ex: '19:00'."),
                  descricao: z
                    .string()
                    .describe(
                      "Descrição da jogada, ex: 'Série de 500 — 4 reais' ou 'Kit churrasco + airfryer'.",
                    ),
                }),
              )
              .min(1),
            bolaDoDia: z.string().describe("Número e/ou descrição da bola do dia."),
            premioBingo: z
              .string()
              .optional()
              .describe("Prêmio extra para quem bater bingo na bola do dia."),
            slogan: z.string().default("NÃO PERCAM, BOA SORTE!!!").describe("Slogan final."),
            observacoes: z
              .string()
              .optional()
              .describe("Detalhes visuais extras pedidos pelo usuário."),
          }),
          execute: async (input) => {
            const refs = await getGlorexReferences(origin);

            const promptText = `Crie uma ARTE PROMOCIONAL VERTICAL (formato flyer 1024x1536) para o "NOVO GLOREX PRESENCIAL" seguindo EXATAMENTE este briefing:

Dia: ${input.dia}
Abertura: ${input.abertura}
Jogadas:
${input.jogadas.map((j) => `- ${j.horario} → ${j.descricao}`).join("\n")}
Bola do dia: ${input.bolaDoDia}
${input.premioBingo ? `Prêmio extra de bingo: ${input.premioBingo}` : ""}
Slogan final: ${input.slogan}
${input.observacoes ? `Observações: ${input.observacoes}` : ""}

REGRAS DE DESIGN OBRIGATÓRIAS:
- Fundo BRANCO limpo e predominante.
- Paleta de destaques em LARANJA-AMARELADO vibrante (tons #F5A623, #FFB800, #FF8A00, #FFD24A). Acentos sutis em vermelho ou dourado apenas para contraste.
- Inclua no topo a LOGO "NOVO GLOREX PRESENCIAL" — use a PRIMEIRA imagem de referência exatamente como está, mantendo proporções, formato e cores originais. NÃO altere a logo.
- Layout vertical estilo flyer: cabeçalho com logo + dia/abertura, blocos com ícone de relógio para cada jogada (horário grande + descrição), uma seção de destaque para a "BOLA DO DIA" com bola de bingo numerada, rodapé com slogan.
- Tipografia bold, impactante, fácil de ler à distância.
- Use ilustrações realistas dos prêmios mencionados (kit churrasco, airfryer com carnes, frigobar com cervejas, caixa de picanha, etc.) quando citados.

VARIAÇÃO OBRIGATÓRIA (muito importante):
- As imagens de referência mostram o ESTILO/ESTRUTURA do Glorex, mas você NÃO deve copiá-las. Crie uma arte NOVA e ÚNICA.
- Varie a paleta exata dentro da família laranja-amarelada (gradientes, tons quentes diferentes a cada arte).
- Varie a disposição dos blocos de horários (cantos arredondados diferentes, alinhamentos, tamanhos relativos).
- Varie os elementos decorativos (estrelas, brilhos, moedas douradas, fitas, raios, ícones de troféu/cifrão/relógio).
- Os templates com fundo escuro (preto, vermelho, azul, dourado) são apenas REFERÊNCIA DE COMPOSIÇÃO — o fundo final deve sempre ser BRANCO com detalhes laranja-amarelados.
- Se houver imagens de "artes anteriores geradas" entre as referências, use-as para entender o estilo já estabelecido pelo usuário, mas crie algo levemente diferente (paleta, layout, decoração) — nunca uma cópia.

- Não escreva nenhum texto em inglês. Tudo em português.

Devolva APENAS a imagem final, sem texto extra.`;

            const shuffled = [...refs.templates].sort(() => Math.random() - 0.5);
            const sampledTemplates = shuffled.slice(0, 2);

            const userContent: Array<
              { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
            > = [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: refs.logo.dataUrl } },
              ...sampledTemplates.map((t) => ({
                type: "image_url" as const,
                image_url: { url: t.dataUrl },
              })),
              ...previousArts.map((url) => ({
                type: "image_url" as const,
                image_url: { url },
              })),
            ];

            try {
              const res = await fetchGatewayWithRetry({
                apiKey,
                requestId,
                body: {
                  model: "google/gemini-3.1-flash-image-preview",
                  messages: [{ role: "user", content: userContent }],
                  modalities: ["image", "text"],
                },
              });

              if (!res.ok) {
                const text = await res.text();
                let userMsg: string;
                if (res.status === 402) {
                  userMsg =
                    "Os créditos da I.A GX acabaram. Adicione créditos no Lovable Cloud e tente novamente.";
                } else if (res.status === 429) {
                  userMsg =
                    "Muitas gerações em sequência. Aguarde alguns segundos e tente de novo.";
                } else if (res.status >= 500) {
                  userMsg =
                    "O serviço de imagem está instável agora. Tente novamente em instantes.";
                } else {
                  userMsg = `Falha ao gerar imagem (${res.status}).`;
                }
                logEvent({
                  kind: "gen-fail",
                  requestId,
                  status: res.status,
                  body: text.slice(0, 300),
                });
                return {
                  ok: false as const,
                  error: userMsg,
                  requestId,
                };
              }

              const data = (await res.json()) as {
                choices?: Array<{
                  message?: {
                    images?: Array<{ image_url?: { url?: string } }>;
                    content?: string;
                  };
                }>;
              };

              const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

              if (!imageUrl) {
                logEvent({
                  kind: "gen-fail",
                  requestId,
                  reason: "no-image-in-response",
                });
                return {
                  ok: false as const,
                  error: "O modelo não retornou imagem. Tente novamente.",
                  requestId,
                };
              }

              logEvent({
                kind: "gen-ok",
                requestId,
                imageBytes: imageUrl.length,
              });

              return {
                ok: true as const,
                imageDataUrl: imageUrl,
                requestId,
                resumo: {
                  dia: input.dia,
                  abertura: input.abertura,
                  bolaDoDia: input.bolaDoDia,
                },
              };
            } catch (err) {
              const isAbort =
                err instanceof Error &&
                (err.name === "AbortError" || err.message.includes("aborted"));
              logEvent({
                kind: "gen-exception",
                requestId,
                error: err instanceof Error ? err.message : String(err),
              });
              return {
                ok: false as const,
                error: isAbort
                  ? "A geração demorou demais e foi cancelada. Tente de novo."
                  : "Não foi possível conectar ao serviço de imagem.",
                requestId,
              };
            }
          },
          toModelOutput: ({ output }) => {
            const result = output as { ok?: boolean; error?: string };
            return {
              type: "text" as const,
              value: result.ok
                ? "Arte do Novo Glorex gerada com sucesso. A imagem já foi entregue ao usuário na interface."
                : `Falha ao gerar a arte: ${result.error ?? "erro desconhecido"}`,
            };
          },
        });

        const result = streamText({
          model: chatModel,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools: { gerar_arte_glorex: gerarArte },
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          headers: {
            "X-Request-Id": requestId,
            "X-Content-Type-Options": "nosniff",
          },
          onError: (error) => {
            logEvent({
              kind: "stream-error",
              requestId,
              error: error instanceof Error ? error.message : String(error),
            });
            return error instanceof Error
              ? `${error.message} (id: ${requestId})`
              : `Erro desconhecido (id: ${requestId})`;
          },
        });
      },
    },
  },
});
