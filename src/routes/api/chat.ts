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

            const paleta = (() => {
              const paletas = [
                "VERMELHO + PRETO — vermelho saturado neon e preto profundo, com acentos dourados e brancos brilhantes",
                "ROXO + ROSA — roxo elétrico e rosa neon vibrante, com glow magenta e detalhes brancos",
                "AZUL + ROXO — azul royal e roxo profundo, com glow ciano/violeta e brilhos dourados",
                "VERDE NEON + PRETO — preto profundo com explosões em verde neon luxuoso e detalhes dourados",
                "DOURADO + VERMELHO — dourado metálico brilhante sobre vermelho intenso, clima de premiação luxuosa",
                "LARANJA + AMARELO — laranja saturado e amarelo neon, com brilhos brancos e contornos pretos fortes",
                "AZUL NEON + PRETO — preto profundo com azul neon elétrico, glow ciano e detalhes prateados/dourados",
              ];
              return paletas[Math.floor(Math.random() * paletas.length)];
            })();

            const promptText = `Crie uma ARTE PROMOCIONAL VERTICAL no formato 1080x1920 (proporção 9:16) para o evento do "NOVO GLOREX PRESENCIAL". Estética EXTREMAMENTE chamativa, MODERNA, PROFISSIONAL, inspirada em flyers brasileiros de BINGO / PREMIAÇÕES / CASSINO. A arte deve transmitir EMOÇÃO, URGÊNCIA, SORTE, RIQUEZA e ENTRETENIMENTO. Pensada para Instagram Stories e WhatsApp Status.

==============================
ESTILO GERAL
==============================
Design ultra vibrante, com iluminação NEON, brilhos intensos, sombras fortes, GLOW colorido, efeitos 3D e tipografia gigante. A arte deve parecer PREMIUM, lotada de informação organizada visualmente sem ficar bagunçada. Misture elementos de cassino, bingo, sorteios e eventos noturnos. Contraste forte entre fundo e textos. Layout dinâmico com caixas, divisórias luminosas, molduras brilhantes e elementos flutuantes.

==============================
IDENTIDADE VISUAL
==============================
- LOGO "NOVO GLOREX PRESENCIAL" SEMPRE posicionada no CANTO SUPERIOR ESQUERDO da arte, em tamanho PEQUENO/COMPACTO (ocupando no máximo ~15-18% da largura da arte), como uma marca-d'água/selo de identidade — NUNCA grande, NUNCA centralizada, NUNCA dominando a composição. Mantenha brilho sutil e fidelidade total ao logo original (use a PRIMEIRA imagem de referência como base). O restante do espaço do topo é livre para título do dia e demais elementos.

==============================
PALETA DESTA GERAÇÃO
==============================
${paleta}.
Cores sempre SATURADAS, VIBRANTES, aparência NEON / LUXUOSA. O fundo pode conter gradientes fortes, fumaça colorida, luzes, partículas, faíscas, raios e brilho radial. Use paleta DIFERENTE das últimas artes enviadas como referência.

REGRA OBRIGATÓRIA DE COR PREDOMINANTE:
- Escolha UMA cor predominante para esta arte (com base na paleta acima) e use ela na MAIORIA dos elementos visuais: fundo principal, faixas, blocos de horários/prêmios, molduras, glow e detalhes decorativos.
- Não precisa ser a única cor — cores de apoio e metálicos (dourado, prata) podem aparecer em destaques —, mas a cor predominante deve DOMINAR visualmente a composição (ex: se for vermelho, a arte inteira deve "respirar" vermelho).
- Cada arte nova deve ter uma cor predominante DIFERENTE da arte anterior.

==============================
TIPOGRAFIA
==============================
Textos ENORMES, extremamente legíveis, em NEGRITO, com aparência 3D ou semi-3D. PREFERÊNCIA FORTE por TEXTO BRANCO na maior parte dos textos (títulos, horários, descrições) — branco puro com contorno escuro e sombra para garantir contraste sobre a cor predominante. Use dourado, amarelo neon ou cores quentes APENAS em destaques pontuais (ex: valor de prêmio principal, número da bola do dia). O título principal do dia ("${input.dia}") deve DOMINAR a composição visual.

==============================
ESTRUTURA DA ARTE (em blocos)
==============================
1. CABEÇALHO: logo PEQUENA no canto superior ESQUERDO + título do dia/evento "${input.dia}" ocupando o centro/direita do topo em destaque gigante.
2. FAIXA DE ABERTURA em destaque: "ABERTURA ${input.abertura}".
3. HORÁRIOS E PREMIAÇÕES organizados em LINHAS HORIZONTAIS, com os horários SEMPRE alinhados na lateral ESQUERDA, cada horário colado exatamente ao prêmio correspondente. Cada linha com ícone de RELÓGIO ao lado do horário. NUNCA cobrir horários com caixas, textos ou imagens. O TEXTO DE CADA PRÊMIO deve ser em TIPOGRAFIA 3D DESTACADA — letras em relevo, extrusão visível, contorno grosso, sombra projetada, cores metálicas/neon (dourado, branco brilhante, amarelo neon, vermelho), com glow ao redor, parecendo "saltar" da arte. Cada prêmio precisa CHAMAR A ATENÇÃO visualmente como o elemento mais importante da linha:
${input.jogadas.map((j) => `   ${j.horario} — ${j.descricao}`).join("\n")}
4. DESTAQUE DA "BOLA DO DIA": bola de bingo GIGANTE altamente destacada com brilho intenso, normalmente na área central/intermediária da arte, mostrando o número "${input.bolaDoDia}".
${input.premioBingo ? `5. BLOCO ESPECIAL: "NAS JOGADAS ANUNCIADAS, QUEM BATER O BINGO COM A BOLA ${input.bolaDoDia}, PRÊMIO DE BINGO MAIS ${input.premioBingo}".` : ""}
6. RODAPÉ CHAMATIVO com a frase: "${input.slogan}" (estilo "NÃO PERCAM!!!", "BOA SORTE", "SEXTA ESPECIAL", "DIA DAS MÃES", "CAIXA DE PICANHA" — adapte o tom).
${input.observacoes ? `\nObservações extras do briefing: ${input.observacoes}` : ""}

==============================
ELEMENTOS VISUAIS OBRIGATÓRIOS
==============================
- Bolas de bingo GIGANTES com números bem destacados.
- Relógios ao lado de cada horário.
- Dinheiro brasileiro (cédulas reais R$) voando.
- Confetes, estrelas brilhantes, luzes neon, faíscas, partículas luminosas, fumaça colorida.
- Efeitos visuais de cassino premium.

==============================
PREMIAÇÕES FÍSICAS (quando citadas)
==============================
Quando aparecer item físico (airfryer, frigobar, caixa de picanha, kit churrasco, carnes premium, cervejas geladas, churrasco), ilustrar de forma REALISTA e PREMIUM, como anúncio comercial LUXUOSO — bem iluminado, apetitoso, chamativo:
- Airfryer moderna cheia de carnes nobres.
- Frigobar cheio de cervejas geladas.
- Caixa de picanha, kit churrasco completo, carnes premium.
- Churrasco apetitoso.
NUNCA usar marcas famosas reais nos produtos.

==============================
LAYOUT
==============================
Composição MUITO organizada visualmente. Nenhum texto pode ficar tampado, cortado ou sobreposto incorretamente. Cada informação tem seu espaço próprio. Evitar poluição visual mesmo com muitos elementos.

==============================
EFEITOS
==============================
Glow neon, reflexos, profundidade, iluminação cinematográfica, sombra intensa, brilhos metálicos, gradientes fortes, contornos luminosos, efeito cassino premium.

==============================
CLIMA
==============================
Emoção, urgência, expectativa, sorte, diversão, riqueza, evento lotado, energia de cassino/bingo moderno.

==============================
REGRAS CRÍTICAS
==============================
- NÃO inventar informações além das fornecidas acima.
- Manter TODOS os horários, números e valores EXATAMENTE como enviados.
- NÃO cortar, cobrir ou sobrepor textos importantes — especialmente os HORÁRIOS na coluna esquerda.
- NÃO usar marcas famosas reais nos produtos ilustrados.
- TUDO em PORTUGUÊS BRASILEIRO. Nenhuma palavra em inglês.
- Cada arte deve ser ÚNICA — varie disposição dos blocos, decorações e enquadramento em relação às artes anteriores enviadas como referência, e use paleta DIFERENTE da última.

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
