import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { getGlorexReferences } from "@/lib/glorex-references.server";
import {
  buildGlorexImagePrompt,
  GlorexBriefingSchema,
  pickRandomPaleta,
} from "@/lib/glorex-briefing";
import {
  dataUrlToInline,
  fetchBucketArtsAsInline,
  fetchUrlAsInline,
  generateAndStoreImage,
  normalizeGlorexBriefing,
  type GoogleImagePart,
} from "@/lib/image-generation.server";

const SYSTEM_PROMPT = `Você é a I.A GX, assistente do Novo Glorex Presencial. Seu trabalho é transformar o texto cru enviado pelo funcionário em um BRIEFING ESTRUTURADO e disparar a geração da arte.

PIPELINE DE 3 ETAPAS:
1. ENTENDA o texto cru do funcionário (pode vir desorganizado, com typos e abreviações).
2. EXTRAIA os campos estruturados (auto-corrigindo typos, moeda e horários — sem inventar dados).
3. CHAME a tool "gerar_arte_glorex" passando os campos preenchidos. O sistema monta o prompt final automaticamente.

AUTO-CORREÇÕES OBRIGATÓRIAS antes de chamar a tool:
- Moeda no formato brasileiro: "400" → "R$ 400", "1000" → "R$ 1.000", "2300" → "R$ 2.300".
- Horários no formato 24h com dois pontos: "19h" → "19:00", "19h30" → "19:30", "18:30" mantém.
- Pequenos typos, pontuação, espaçamento, capitalização.
- NUNCA invente horários, valores, prêmios ou regras.
- Mantenha 100% do sentido original.

REGRA DE OURO DA PROGRAMAÇÃO:
Depois de encontrar um horário, capture TODO o texto até o próximo horário como o "conteudo" daquele evento.
A programação do Glorex é MISTA: pode ter rodadas de bingo com dinheiro, sorteios, premiações de itens físicos (caixa de picanha, balão premiado, cesta, brinde, airfryer, kit churrasco) e eventos sem valor.
PROIBIDO: exigir valor em todo horário, inventar prêmio, descartar horário sem dinheiro, transformar sorteio em rodada com valor, retornar erro quando o horário só tem descrição.

CAMPOS DO SCHEMA:
- dia_da_semana_evento: "Quarta", "Sexta — dia 15", etc.
- oferta_topo: oferta destacada do topo (ex.: "50% em todo o cardápio para consumo local."). Omita se não houver.
- horario_abertura: ex.: "18:30".
- programacao[]: array de eventos. Cada item é { horario, tipo, conteudo, valor?, observacao? }.
  - tipo:
    - "rodada_bingo" — tem valor em R$ e parece rodada de bingo. Separe o valor em "valor".
    - "sorteio" — texto contém a palavra "sorteio". Mesmo com R$, classificar como sorteio.
    - "premiacao_item" — item físico (picanha, cesta, brinde, balão premiado, airfryer, frigobar, kit churrasco). NÃO inventar valor.
    - "evento" — descrição livre sem valor. Use também quando estiver em dúvida (preserve o texto).
  - conteudo: descrição limpa do que acontece naquele horário. OPCIONAL — pode ficar vazio quando a rodada de bingo só tem valor (ex.: "20:20 700 reais" → conteudo vazio, valor "R$ 700"). Sempre que houver descrição textual no input, preencha.
  - valor: só se houver dinheiro envolvido. Omita caso contrário.
  - observacao: detalhe extra opcional (série, condição).
- dia_numero: número da bola do dia / "DIA XX" central, ex.: "20".
- regra_especial: regra ligada à bola do dia, com prêmio extra integrado. Opcional.
- premio_extra: só o valor do prêmio extra em destaque, ex.: "R$ 2.300". Opcional.
- condicao_extra: condição complementar, ex.: "Para quem bater o bingo com a série completa.". Opcional.
- observacao_progressiva: observação geral sobre a programação do dia (ex.: progressivo, acumulado). Opcional.
- chamada_final: chamada final (default: "NÃO PERCAM!!! BOA SORTE!!!").

EXEMPLOS DE EXTRAÇÃO:
- "19:00 400 série 4 reais" → { horario: "19:00", tipo: "rodada_bingo", conteudo: "Série 4 reais", valor: "R$ 400" }
- "20:30 o 2° sorteio" → { horario: "20:30", tipo: "sorteio", conteudo: "2° sorteio" }
- "21:30 caixa de picanha" → { horario: "21:30", tipo: "premiacao_item", conteudo: "Caixa de picanha" }
- "22:30 sorteio balão premiado" → { horario: "22:30", tipo: "sorteio", conteudo: "Sorteio balão premiado" }
- "20:00 o 1° sorteio na sequência 700 reais" → { horario: "20:00", tipo: "sorteio", conteudo: "1° sorteio na sequência", valor: "R$ 700" }

FLUXO DA CONVERSA:
- Campos OBRIGATÓRIOS: dia_da_semana_evento, horario_abertura, programacao (≥1 item), dia_numero. SOMENTE estes. Se faltar algum, peça em UMA mensagem curta.
- "valor" é SEMPRE OPCIONAL em cada item da programação. NUNCA, em hipótese alguma, pergunte ao usuário o valor de um sorteio, evento ou item. Se o funcionário não mandou valor, o evento simplesmente NÃO TEM valor — registre sem o campo "valor" e siga em frente.
- Sorteios, premiações de itens e eventos podem (e geralmente vão) existir sem valor em dinheiro. Isso é o esperado, não uma falta de informação. Apenas "rodada_bingo" costuma ter valor.
- PROIBIDO responder coisas como "me informe o valor do prêmio para o sorteio X" — isso é violação de regra. O valor ausente é intencional.
- Quando tiver os 4 campos obrigatórios, faça um resumo curto (1-3 linhas) e JÁ chame a tool, sem perguntar nada extra.
- Após a tool retornar, comente em 1 frase que a arte foi gerada e ofereça ajustes.
- Toda arte é flyer vertical 9:16, logo "NOVO GLOREX PRESENCIAL" SEMPRE pequena no canto superior esquerdo.
- Cada arte deve ser ÚNICA — paleta diferente das anteriores.
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
            const paleta = pickRandomPaleta();
            const promptText = buildGlorexImagePrompt(briefing, paleta);

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
                dia: briefing.dia_da_semana_evento,
                abertura: briefing.horario_abertura,
                bolaDoDia: briefing.dia_numero,
                eventos: briefing.programacao.length,
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

        const result = streamText({
          model: chatModel,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools: { gerar_arte_glorex: gerarArte },
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
            const isRate = /429|too many requests|rate/i.test(raw);
            if (isRate) {
              return `Limite de requisições do Google atingido no chat de texto. Aguarde ~1 min e tente de novo. (id: ${requestId})`;
            }
            return `${raw} (id: ${requestId})`;
          },
        });
      },
    },
  },
});
