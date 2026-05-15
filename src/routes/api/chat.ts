import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { getGlorexReferences } from "@/lib/glorex-references.server";

const SYSTEM_PROMPT = `Você é a I.A GX, assistente do Novo Glorex Presencial especializada em criar artes promocionais para bingos e sorteios.

Seu trabalho:
- Conversar em português brasileiro, de forma direta, simpática e objetiva.
- Coletar com o usuário os dados da arte: dia da semana e data, horário de abertura, jogadas (horário + valor de cada série), bola do dia, prêmios extras (kit churrasco, airfryer, frigobar, picanha etc.) e o slogan final.
- Quando tiver dados suficientes, faça um resumo curto e CHAME a tool "gerar_arte_glorex" passando todas as informações estruturadas. Não invente dados que o usuário não forneceu.
- Após a tool retornar, comente brevemente que a arte foi gerada e ofereça ajustes (mudar paleta, refazer com outra bola do dia, adicionar mais jogadas etc.).
- Toda arte tem fundo branco com detalhes laranja-amarelados, formato vertical estilo flyer, e SEMPRE inclui a logo "NOVO GLOREX PRESENCIAL".
- Cada arte gerada deve ser ÚNICA: variar paleta dentro do laranja-amarelado, disposição dos blocos e elementos decorativos. Nunca repetir uma arte anterior.
- Se o usuário pedir algo fora do escopo, explique educadamente que você só cria artes do Novo Glorex.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        const body = (await request.json()) as {
          messages: UIMessage[];
          artesGeradas?: string[];
        };
        const { messages, artesGeradas = [] } = body;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const origin = new URL(request.url).origin;
        const gateway = createLovableAiGatewayProvider(apiKey);
        const chatModel = gateway("google/gemini-3-flash-preview");

        // Cap previous arts to avoid huge payloads / model rejecting too many images
        const previousArts = (artesGeradas || []).slice(-1);

        const gerarArte = tool({
          description:
            "Gera a arte promocional do Novo Glorex Presencial usando Nano Banana 2, com fundo branco, detalhes laranja-amarelados e a logo Novo Glorex. Use quando o usuário tiver fornecido dados suficientes.",
          inputSchema: z.object({
            dia: z
              .string()
              .describe("Dia da semana e/ou data, ex: 'Sexta — dia 15'."),
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
            slogan: z
              .string()
              .default("NÃO PERCAM, BOA SORTE!!!")
              .describe("Slogan final."),
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

            // Pick a rotating subset of templates (2) so each call sees variety
            // without overloading the image model with too many references.
            const shuffled = [...refs.templates].sort(() => Math.random() - 0.5);
            const sampledTemplates = shuffled.slice(0, 2);

            const userContent: Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
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

            const res = await fetch(
              "https://ai.gateway.lovable.dev/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Lovable-API-Key": apiKey,
                  "X-Lovable-AIG-SDK": "vercel-ai-sdk",
                },
                body: JSON.stringify({
                  model: "google/gemini-3.1-flash-image-preview",
                  messages: [{ role: "user", content: userContent }],
                  modalities: ["image", "text"],
                }),
              },
            );

            if (!res.ok) {
              const text = await res.text();
              return {
                ok: false as const,
                error: `Falha ao gerar imagem (${res.status}): ${text.slice(0, 300)}`,
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

            const imageUrl =
              data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

            if (!imageUrl) {
              return {
                ok: false as const,
                error: "O modelo não retornou imagem.",
              };
            }

            return {
              ok: true as const,
              imageDataUrl: imageUrl,
              resumo: {
                dia: input.dia,
                abertura: input.abertura,
                bolaDoDia: input.bolaDoDia,
              },
            };
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
          onError: (error) => {
            console.error("Chat error:", error);
            return error instanceof Error ? error.message : "Erro desconhecido";
          },
        });
      },
    },
  },
});
