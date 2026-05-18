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
const GOOGLE_TIMEOUT_MS = 150_000;

// Modelo de imagem do Google. Nano Banana 2 Flash — versão INTERMEDIÁRIA
// (entre o antigo gemini-2.5-flash-image e o gemini-3-pro-image-preview).
// Boa qualidade com custo/cota razoáveis.
const GOOGLE_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
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

async function callGoogleImageOnce(opts: {
  apiKey: string;
  parts: GoogleImagePart[];
  requestId: string;
  model: string;
  attempt: number;
  parentSignal?: AbortSignal;
}): Promise<Response> {
  const { apiKey, parts, requestId, model, attempt, parentSignal } = opts;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    apiKey,
  )}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
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
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
  }
}

// Modelo de fallback quando o principal está sobrecarregado (503/429/UNAVAILABLE).
const GOOGLE_IMAGE_FALLBACK_MODEL = "gemini-2.5-flash-image";

async function callGoogleImage(opts: {
  apiKey: string;
  parts: GoogleImagePart[];
  requestId: string;
}): Promise<Response> {
  const { apiKey, parts, requestId } = opts;
  const models = [GOOGLE_IMAGE_MODEL, GOOGLE_IMAGE_MODEL, GOOGLE_IMAGE_FALLBACK_MODEL];
  let lastRes: Response | null = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const res = await callGoogleImageOnce({
        apiKey,
        parts,
        requestId,
        model,
        attempt: i + 1,
      });
      // 5xx, 429 ou 400 "Unable to process input image" (transitório) → retry / fallback
      let retriable = res.status >= 500 || res.status === 429;
      if (!retriable && res.status === 400) {
        const cloned = res.clone();
        const bodyText = await cloned.text().catch(() => "");
        if (/unable to process input image/i.test(bodyText)) {
          retriable = true;
          // reembrulha res com o texto já consumido
          lastRes = new Response(bodyText, { status: res.status, headers: res.headers });
        }
      }
      if (retriable) {
        if (!lastRes) lastRes = res;
        if (i < models.length - 1) {
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          continue;
        }
        return lastRes;
      }
      return res;
    } catch (err) {
      logEvent({
        kind: "google-image-throw",
        requestId,
        model,
        attempt: i + 1,
        error: err instanceof Error ? err.message : String(err),
      });
      if (i < models.length - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  return lastRes!;
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

            // Envia TODOS os templates de referência para que o modelo aprenda
            // o estilo visual da marca (variação de cores, layout, tipografia).
            const sampledTemplates = refs.templates;

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
                  if (googleMessage && /unable to process input image/i.test(googleMessage)) {
                    userMsg = `400 — O Google rejeitou as imagens de referência mesmo após retry e fallback. Geralmente é transitório: tente novamente em alguns segundos.`;
                  } else {
                    userMsg = `400 — Requisição rejeitada pelo Google${googleMessage ? `: ${googleMessage}` : ""}.`;
                  }
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
              return `Limite de requisições do Google atingido no chat de texto (gemini-2.5-flash). Aguarde ~1 min e tente de novo. (id: ${requestId})`;
            }
            return `${raw} (id: ${requestId})`;
          },
        });
      },
    },
  },
});
