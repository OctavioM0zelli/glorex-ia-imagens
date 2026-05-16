import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

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

const MAX_ARTES_GERADAS = 5;
const MAX_ART_DATAURL_LENGTH = 900_000;
const GOOGLE_TIMEOUT_MS = 90_000;

// Modelo de imagem do Google (Nano Banana). Disponível na cota gratuita
// generosa do tier free do Google AI Studio.
const GOOGLE_IMAGE_MODEL = "gemini-2.5-flash-image";
// Modelo de texto para o chat. Cota gratuita ~1500 req/dia.
const GOOGLE_TEXT_MODEL = "gemini-2.5-flash";

const RequestSchema = z.object({
  messages: z.array(z.any()).min(1).max(500),
  artesGeradas: z.array(z.string()).max(MAX_ARTES_GERADAS).optional().default([]),
});

function logEvent(event: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
  } catch {
    console.log("log-failed", event);
  }
}

// Converte um data URL "data:image/png;base64,XXXX" em { mimeType, data }
function dataUrlToInline(dataUrl: string): { mimeType: string; data: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

type GoogleImagePart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

async function callGoogleImage(opts: {
  apiKey: string;
  parts: GoogleImagePart[];
  requestId: string;
}): Promise<Response> {
  const { apiKey, parts, requestId } = opts;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_IMAGE_MODEL}:generateContent?key=${encodeURIComponent(
    apiKey,
  )}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
      signal: controller.signal,
    });
    logEvent({
      kind: "google-image",
      requestId,
      status: res.status,
      durationMs: Date.now() - startedAt,
    });
    return res;
  } finally {
    clearTimeout(timer);
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
        const artesGeradas = (parsed.artesGeradas ?? []).filter(
          (arte) => arte.length <= MAX_ART_DATAURL_LENGTH,
        );
        const origin = new URL(request.url).origin;

        // Provider OpenAI-compatível apontando para a API direta do Google
        // (chave gratuita do usuário). Substitui o Lovable AI Gateway.
        const provider = createOpenAICompatible({
          name: "google-direct",
          baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
          headers: {
            Authorization: `Bearer ${googleKey}`,
          },
        });
        const chatModel = provider(GOOGLE_TEXT_MODEL);

        const previousArts = artesGeradas.slice(-MAX_ARTES_GERADAS);

        logEvent({
          kind: "chat-start",
          requestId,
          messageCount: messages.length,
          receivedArts: parsed.artesGeradas?.length ?? 0,
          acceptedArts: previousArts.length,
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
          execute: async (input) => {
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
                  "Falha interna — não consegui carregar as imagens de referência do Novo Glorex para montar a arte. Tente novamente; se continuar, o problema está no carregamento dos arquivos da marca.",
                requestId,
              };
            }

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
- Estilo de FUNDO desta arte: ${(() => {
              const estilos = [
                "FUNDO PRETO profundo com explosões de laranja, dourado e vermelho",
                "FUNDO VERMELHO vibrante com detalhes em dourado e amarelo",
                "FUNDO AZUL ESCURO/ROYAL com acentos dourados e brancos",
                "FUNDO DOURADO/AMARELO intenso com detalhes em vermelho e preto",
                "FUNDO BRANCO com detalhes laranja-amarelados vibrantes",
                "FUNDO VERDE ESCURO com dourado e laranja para contraste",
                "FUNDO ROXO/MAGENTA com dourado e amarelo neon",
                "FUNDO GRADIENTE laranja → vermelho → dourado",
              ];
              return estilos[Math.floor(Math.random() * estilos.length)];
            })()}.
- Use cores impactantes e contrastantes — cada arte deve PARECER DIFERENTE da anterior, exatamente como nos templates de referência (que alternam fundos pretos, vermelhos, azuis, dourados).
- Inclua no topo a LOGO "NOVO GLOREX PRESENCIAL" — use a PRIMEIRA imagem de referência exatamente como está, mantendo proporções, formato e cores originais. NÃO altere a logo.
- Layout vertical estilo flyer (1024x1536): cabeçalho com logo + dia/abertura, blocos com ícone de relógio para cada jogada (horário grande + descrição), uma seção de destaque para a "BOLA DO DIA" com bola de bingo numerada, rodapé com slogan.
- Tipografia bold, impactante, fácil de ler à distância.
- Use ilustrações realistas dos prêmios mencionados (kit churrasco, airfryer com carnes, frigobar com cervejas, caixa de picanha, etc.) quando citados.

VARIAÇÃO OBRIGATÓRIA:
- Crie uma arte NOVA e ÚNICA. Não copie nenhum template nem nenhuma arte anterior.
- Varie disposição dos blocos, decorações (estrelas, brilhos, moedas, fitas, raios, troféus), tipografia e enquadramento.
- Se houver "artes anteriores geradas" entre as referências, use-as apenas para manter coerência de marca, mas escolha um esquema de cor de fundo DIFERENTE da última.

- Não escreva nenhum texto em inglês. Tudo em português.

Devolva APENAS a imagem final, sem texto extra.`;

            const shuffled = [...refs.templates].sort(() => Math.random() - 0.5);
            const sampledTemplates = shuffled.slice(0, 2);

            // Monta partes no formato nativo do Google
            const parts: GoogleImagePart[] = [{ text: promptText }];

            const logoInline = dataUrlToInline(refs.logo.dataUrl);
            if (logoInline) {
              parts.push({
                inline_data: { mime_type: logoInline.mimeType, data: logoInline.data },
              });
            }

            for (const t of sampledTemplates) {
              const inline = dataUrlToInline(t.dataUrl);
              if (inline) {
                parts.push({
                  inline_data: { mime_type: inline.mimeType, data: inline.data },
                });
              }
            }

            for (const url of previousArts) {
              const inline = dataUrlToInline(url);
              if (inline) {
                parts.push({
                  inline_data: { mime_type: inline.mimeType, data: inline.data },
                });
              }
            }

            try {
              const res = await callGoogleImage({ apiKey: googleKey, parts, requestId });

              if (!res.ok) {
                const text = await res.text();
                // Tenta extrair o erro estruturado do Google
                let googleStatus: string | undefined;
                let googleMessage: string | undefined;
                let googleCode: string | number | undefined;
                try {
                  const parsedErr = JSON.parse(text) as {
                    error?: { code?: number | string; message?: string; status?: string };
                  };
                  googleStatus = parsedErr.error?.status;
                  googleMessage = parsedErr.error?.message;
                  googleCode = parsedErr.error?.code;
                } catch {
                  /* corpo não é JSON */
                }

                let userMsg: string;
                let category:
                  | "quota"
                  | "auth"
                  | "permission"
                  | "model_not_found"
                  | "bad_request"
                  | "upstream"
                  | "unknown";
                if (res.status === 429) {
                  category = "quota";
                  userMsg = `429 — Cota gratuita do Google atingida${googleMessage ? `: ${googleMessage}` : ""}. Tente novamente em algumas horas (reset à meia-noite Pacífico) ou amanhã.`;
                } else if (res.status === 401) {
                  category = "auth";
                  userMsg = `401 — Chave do Google inválida ou expirada${googleMessage ? `: ${googleMessage}` : ""}. Gere uma nova em aistudio.google.com/apikey.`;
                } else if (res.status === 403) {
                  category = "permission";
                  userMsg = `403 — Chave sem permissão para o modelo ${GOOGLE_IMAGE_MODEL}${googleMessage ? `: ${googleMessage}` : ""}. Verifique se a Generative Language API está habilitada no projeto.`;
                } else if (res.status === 404) {
                  category = "model_not_found";
                  userMsg = `404 — Modelo ${GOOGLE_IMAGE_MODEL} não encontrado${googleMessage ? `: ${googleMessage}` : ""}. Pode ter sido renomeado ou removido.`;
                } else if (res.status === 400) {
                  category = "bad_request";
                  userMsg = `400 — Requisição rejeitada pelo Google${googleMessage ? `: ${googleMessage}` : ""}.`;
                } else if (res.status >= 500) {
                  category = "upstream";
                  userMsg = `${res.status} — Serviço de imagem do Google instável agora${googleMessage ? ` (${googleMessage})` : ""}. Tente novamente em instantes.`;
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
                  body: text.slice(0, 300),
                });
                return {
                  ok: false as const,
                  category,
                  error: userMsg,
                  httpStatus: res.status,
                  googleStatus,
                  googleCode,
                  requestId,
                };
              }

              const data = (await res.json()) as {
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

              // Procura a primeira parte com inlineData (formato camelCase do Google)
              let imageDataUrl: string | undefined;
              const partsOut = data.candidates?.[0]?.content?.parts ?? [];
              for (const p of partsOut) {
                const inline = (p.inlineData ?? p.inline_data) as
                  | { mimeType?: string; mime_type?: string; data?: string }
                  | undefined;
                const mt = inline?.mimeType ?? inline?.mime_type;
                const dt = inline?.data;
                if (mt && dt) {
                  imageDataUrl = `data:${mt};base64,${dt}`;
                  break;
                }
              }

              if (!imageDataUrl) {
                // Tenta capturar texto de explicação do modelo (ex: bloqueio de safety)
                const textOut = partsOut.map((p) => p.text).filter(Boolean).join(" ").slice(0, 300);
                logEvent({
                  kind: "gen-fail",
                  requestId,
                  reason: "no-image-in-response",
                  modelText: textOut,
                });
                return {
                  ok: false as const,
                  category: "safety" as const,
                  error: `O modelo respondeu mas não devolveu imagem${textOut ? ` (motivo: ${textOut})` : ""}. Pode ser bloqueio de segurança — tente reformular.`,
                  requestId,
                };
              }

              logEvent({ kind: "gen-ok", requestId, imageBytes: imageDataUrl.length });

              return {
                ok: true as const,
                imageDataUrl,
                requestId,
                resumo: {
                  dia: input.dia,
                  abertura: input.abertura,
                  bolaDoDia: input.bolaDoDia,
                },
              };
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              const isAbort =
                err instanceof Error &&
                (err.name === "AbortError" || errMsg.includes("aborted"));
              logEvent({
                kind: "gen-exception",
                requestId,
                errorName: err instanceof Error ? err.name : "unknown",
                error: errMsg,
              });
              const userMsg = isAbort
                ? `Timeout — geração demorou mais de ${Math.round(GOOGLE_TIMEOUT_MS / 1000)}s e foi cancelada. Tente de novo.`
                : `Falha de rede ao chamar o Google (${errMsg.slice(0, 120)}). Verifique conexão / DNS.`;
              return {
                ok: false as const,
                category: isAbort ? ("timeout" as const) : ("network" as const),
                error: userMsg,
                requestId,
              };
            }
          },
          toModelOutput: ({ output }) => {
            const result = output as { ok?: boolean; error?: string; category?: string };
            return {
              type: "text" as const,
              value: result.ok
                ? "Arte do Novo Glorex gerada com sucesso. A imagem já foi entregue ao usuário na interface."
                : `A FERRAMENTA FALHOU (categoria: ${result.category ?? "unknown"}) e NÃO gerou imagem alguma. NÃO diga genericamente "não consigo gerar a arte agora". Um card detalhado já foi mostrado ao usuário com a causa e o requestId. Apenas confirme em 1 frase curta a causa: "${result.error ?? "erro desconhecido"}".`,
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
