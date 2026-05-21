import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { getGlorexReferences } from "@/lib/glorex-references.server";
import {
  dataUrlToInline,
  fetchBucketArtsAsInline,
  fetchUrlAsInline,
  generateAndStoreImage,
  normalizeBriefingInput,
  type GoogleImagePart,
} from "@/lib/image-generation.server";

const SYSTEM_PROMPT = `Você é a I.A GX, assistente do Novo Glorex Presencial especializada em criar artes promocionais para bingos e sorteios.

Seu trabalho:
- Conversar em português brasileiro, de forma direta, simpática e objetiva.
- Coletar com o usuário os dados da arte: dia da semana e data, horário de abertura, jogadas (horário + valor de cada série), bola do dia, prêmios extras (kit churrasco, airfryer, frigobar, picanha etc.) e o slogan final.
- ANTES de chamar a tool, AUTO-CORRIJA o briefing do usuário:
  • corrija pequenos typos, espaçamento e pontuação;
  • padronize moeda no formato brasileiro: "400" → "R$ 400", "1000" → "R$ 1.000", "2300" → "R$ 2.300";
  • reorganize itens claramente relacionados (ex.: horário e prêmio na mesma jogada);
  • NÃO invente horários, valores ou regras que o usuário não forneceu;
  • mantenha 100% do sentido original.
- Quando tiver dados suficientes, faça um resumo curto e CHAME a tool "gerar_arte_glorex" passando todas as informações estruturadas e já normalizadas.
- Após a tool retornar, comente brevemente que a arte foi gerada e ofereça ajustes (mudar paleta, refazer com outra bola do dia, adicionar mais jogadas etc.).
- Toda arte é um flyer vertical 9:16 e SEMPRE inclui a logo "NOVO GLOREX PRESENCIAL" como SELO PEQUENO no canto superior esquerdo (~15-18% da largura — nunca grande, nunca centralizada).
- Cada arte gerada deve ser ÚNICA, variando paleta de fundo, disposição dos blocos e elementos decorativos. Nunca repetir uma arte anterior.
- Se o usuário pedir algo fora do escopo, explique educadamente que você só cria artes do Novo Glorex.`;

const MAX_ARTES_GERADAS = 5;
const GOOGLE_TEXT_MODEL = "gemini-2.5-flash";

const RequestSchema = z.object({
  messages: z.array(z.any()).min(1).max(500),
  // Agora recebemos URLs públicas de artes anteriores (não mais data URLs).
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
            "Gera a arte promocional do Novo Glorex Presencial usando Nano Banana, com fundo branco, detalhes laranja-amarelados e a logo Novo Glorex. Use quando o usuário tiver fornecido dados suficientes.",
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

            // Normaliza moeda (R$), horários e espaçamento antes de montar o prompt.
            const b = normalizeBriefingInput(input);

            const paleta = (() => {
              const paletas = [
                "VERMELHO + PRETO — vermelho saturado neon e preto profundo, com acentos dourados",
                "ROXO + ROSA — roxo elétrico e rosa neon vibrante, com glow magenta",
                "AZUL + ROXO — azul royal e roxo profundo, com glow ciano/violeta e brilhos dourados",
                "VERDE NEON + PRETO — preto profundo com explosões em verde neon luxuoso e detalhes dourados",
                "DOURADO + VERMELHO — dourado metálico brilhante sobre vermelho intenso, clima de premiação luxuosa",
                "LARANJA + AMARELO — laranja saturado e amarelo neon, com contornos pretos fortes",
                "AZUL NEON + PRETO — preto profundo com azul neon elétrico, glow ciano e detalhes dourados",
              ];
              return paletas[Math.floor(Math.random() * paletas.length)];
            })();

            const promptText = `Crie uma ARTE PROMOCIONAL VERTICAL 9:16 (1080x1920) para o "NOVO GLOREX PRESENCIAL". Estilo flyer brasileiro popular-premium de BINGO / SORTEIO / CASSINO: vibrante, brilhante, organizada, ALTAMENTE LEGÍVEL. Pensada para Instagram Stories e WhatsApp Status.

==============================
IDENTIDADE VISUAL — LOGO
==============================
LOGO "NOVO GLOREX PRESENCIAL" SEMPRE no CANTO SUPERIOR ESQUERDO, em tamanho PEQUENO/COMPACTO (~15-18% da largura), nítida e bem visível, mas NUNCA grande, NUNCA centralizada, NUNCA dominando a composição. Use a PRIMEIRA imagem de referência como base do logo.

==============================
PALETA DESTA GERAÇÃO
==============================
${paleta}. Cores SATURADAS, NEON, LUXUOSAS. Fundo ESCURO, vibrante e contrastante, com brilhos, bordas iluminadas, clima festivo/premiação.

REGRA DE COR PREDOMINANTE:
- Escolha UMA cor predominante (da paleta acima) e use ela na MAIORIA dos elementos: fundo principal, faixas, blocos de horários/prêmios, molduras, glow e decoração.
- A arte inteira deve "respirar" essa cor. Dourado/prata aparecem só em destaques.
- Use paleta DIFERENTE das últimas artes enviadas como referência.

==============================
REGRA DE TEXTO E DESTAQUE
==============================
- COR PADRÃO DO TEXTO = BRANCO PURO, com contorno escuro e sombra para contraste sobre o fundo escuro.
- AMARELO/DOURADO apenas para destaques: valores de prêmio (R$), horários importantes, número da bola do dia e chamada final.
- Tipografia GRANDE, LIMPA, IMPACTANTE, em NEGRITO, com aparência 3D nos prêmios.
- Texto NUNCA pode ficar confuso, cortado, sobreposto ou mal distribuído. Priorize CLAREZA acima de excesso de efeitos.
- TUDO em PORTUGUÊS BRASILEIRO.

==============================
ESTRUTURA FIXA EM 6 BLOCOS (siga nesta ordem visual)
==============================

1) BLOCO SUPERIOR ESQUERDO — selo/logo "NOVO GLOREX PRESENCIAL" pequeno no canto.

2) BLOCO SUPERIOR PRINCIPAL — título do dia/evento "${b.dia}" com GRANDE destaque, dominando o topo (centro/direita). Se houver promoção de cardápio ou oferta extra, mostre em box destacado próximo ao topo.

3) BLOCO DE HORÁRIOS — começa com "ABERTURA ${b.abertura}" em destaque. Depois, lista as rodadas em LINHAS HORIZONTAIS, uma por linha, com ícone de RELÓGIO ao lado do horário. Horários SEMPRE alinhados na lateral ESQUERDA. Cada linha: horário + prêmio + informação adicional se existir. Prêmios em tipografia 3D destacada (extrusão, contorno grosso, sombra, glow). Rodadas:
${b.jogadas.map((j) => `   ${j.horario} — ${j.descricao}`).join("\n")}

4) BLOCO CENTRAL DE DESTAQUE — texto "DIA ${b.bolaDoDia}" em GRANDE destaque (número em dourado/amarelo), com uma BOLA DE BINGO GIGANTE central mostrando o número "${b.bolaDoDia}". Ao redor, bolas decorativas menores numeradas.

5) BLOCO DE REGRA ESPECIAL — ${b.premioBingo ? `texto explicando a condição da bola do dia: "NAS JOGADAS ANUNCIADAS, QUEM BATER O BINGO COM A BOLA ${b.bolaDoDia} LEVA ${b.premioBingo}". Destaque FORTE no valor do prêmio extra (dourado, 3D). Se houver condição (ex.: "série completa"), mostre com destaque secundário bem claro.` : `omita este bloco se não houver regra especial.`}

6) BLOCO FINAL/CHAMADA — frase final chamativa "${b.slogan ?? "NÃO PERCAM, BOA SORTE!!!"}" fechando a arte com bastante impacto visual (tipografia gigante, dourado/amarelo + branco).
${b.observacoes ? `\nObservações extras: ${b.observacoes}` : ""}

==============================
ELEMENTOS DECORATIVOS
==============================
Bolas de bingo numeradas, cédulas de dinheiro brasileiro (R$), brilhos, estrelas, confetes, molduras iluminadas, faíscas, partículas luminosas. Visual forte e comercial, mas SEM ficar bagunçado.

==============================
PREMIAÇÕES FÍSICAS (quando citadas)
==============================
Ilustre item físico (airfryer, frigobar, kit churrasco, picanha, cervejas, carnes) de forma REALISTA e PREMIUM, bem iluminado e apetitoso. NUNCA usar marcas reais.

==============================
REGRAS CRÍTICAS
==============================
- NÃO inventar horários, valores ou regras.
- Manter TODOS os horários, números e valores EXATAMENTE como enviados.
- NÃO cortar, cobrir ou sobrepor textos — especialmente os HORÁRIOS na coluna esquerda.
- Cada arte ÚNICA — varie disposição e decoração em relação às artes anteriores; use cor predominante DIFERENTE da última.
- Priorize CLAREZA. Em conflito entre estética e clareza, vence a clareza.

Devolva APENAS a imagem final, sem texto extra.`;

            // Monta partes: prompt + logo + templates + artes anteriores (baixadas das URLs).
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
                dia: input.dia,
                abertura: input.abertura,
                bolaDoDia: input.bolaDoDia,
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
