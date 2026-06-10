// Schema MINIMALISTA do briefing das artes do Novo Glorex Presencial.
// A I.A do chat apenas faz pequenas correções (R$, horários, typos) no texto
// enviado pelo funcionário e repassa como `texto_briefing`. O builder do
// prompt instrui o Gemini a seguir FIELMENTE a estrutura desse texto,
// mantendo apenas as regras visuais fixas da marca (logo pequena, paleta,
// texto branco, destaques em dourado etc.).

import { z } from "zod";

export const GlorexBriefingSchema = z.object({
  texto_briefing: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "Texto livre do funcionário com a programação do dia. Preserve 100% do sentido e da ORDEM original. Faça apenas pequenas correções: moeda no formato brasileiro (R$ 400, R$ 1.000), horários no formato HH:MM (19h → 19:00, 19h30 → 19:30) e typos leves. NÃO reescreva, NÃO resuma, NÃO invente nada. Quebras de linha são importantes — preserve-as.",
    ),
});

export type GlorexBriefing = z.infer<typeof GlorexBriefingSchema>;

// ---------------------------------------------------------------------------
// Builder determinístico do prompt final enviado ao Nano Banana.
// ---------------------------------------------------------------------------

export function buildGlorexImagePrompt(b: GlorexBriefing, paleta: string): string {
  const texto = b.texto_briefing.trim();

  return `Crie uma ARTE PROMOCIONAL VERTICAL 9:16 (1080x1920) para o "NOVO GLOREX PRESENCIAL". Estilo: flyer premium de bingo/cassino brasileiro — vibrante, brilhante, organizado, ALTAMENTE legível. Para Instagram Stories e WhatsApp Status.

==============================

BRIEFING — FONTE ÚNICA DA VERDADE

==============================

Siga FIELMENTE a estrutura, ordem e conteúdo abaixo. NÃO invente, NÃO omita, NÃO reordene. Todo horário, valor, nome e regra aparece EXATAMENTE como escrito:

"""
${texto}
"""

==============================

INFORMAÇÕES SAGRADAS — NUNCA ALTERAR

==============================

PROIBIDO modificar qualquer um destes elementos:

- Data / dia da semana

- Todos os horários (HH:MM)

- Todos os valores em R$

- Número da série / jogada

- Número da bola do dia

- Nomes de prêmios e itens físicos

- Nome/marca do evento

A IA tem LIBERDADE APENAS para:

- Escolher família tipográfica (display bold, serifa premium, neon outline, etc.)

- Decidir peso, tamanho e estilo de fonte de cada bloco

- Criar e posicionar elementos decorativos que NÃO substituam informação real

- Decidir se o logo fica no canto superior esquerdo (pequeno) OU integrado ao cabeçalho (mais proeminente) — conforme melhor se encaixar no layout

==============================

PALETA DESTA GERAÇÃO

==============================

${paleta}. Fundo ESCURO e rico (preto profundo, vinho, azul-marinho ou roxo) com gradiente e brilhos. Raios de luz (burst/rays) irradiando do centro ou do topo. Acentos em OURO METÁLICO (#FFD700 → #B8860B) com shimmer. Neon suave nas bordas dos cards.

==============================

ESTRUTURA DE COMPOSIÇÃO — 7 ZONAS

==============================

Siga esta ordem de cima para baixo, omitindo zonas cujo conteúdo NÃO esteja no briefing:

ZONA 1 — CABEÇALHO:

Logo "NOVO GLOREX PRESENCIAL" em destaque no topo — pode ser pequena no canto superior esquerdo OU centralizada/integrada ao título, conforme o layout. Use a primeira imagem de referência. Abaixo do logo (ou ao lado): DIA DA SEMANA em tipografia display gigante e bold (branca com contorno dourado ou da cor da paleta). Se houver subtítulo de evento especial (ex.: "DIA DAS MÃES", "SEXTA ESPECIAL"), insira em ribbon/faixa colorida logo abaixo.

ZONA 2 — OFERTA ESPECIAL (se houver no briefing):

Box de largura total com fundo dourado ou da cor de destaque. Texto da oferta em negrito, legível. Omita se não houver no briefing.

ZONA 3 — ABERTURA:

Box horizontal dedicado com ícone de relógio à esquerda e "ABERTURA HH:MM" em texto bold. Borda iluminada da cor da paleta.

ZONA 4 — PROGRAMAÇÃO DE HORÁRIOS:

Cada linha do briefing que contenha horário vira 1 CARD HORIZONTAL independente:

- Fundo: gradiente escuro semitransparente

- Borda: 2-3px sólida iluminada (dourado ou neon da paleta), cantos arredondados

- Glow externo suave

- Layout interno: [Ícone relógio] [HH:MM bold branco] | [Descrição/prêmio em dourado bold gigante]

- Se houver valor em R$: valor em tipografia 3D dourada metálica GRANDE à direita

- Cards empilhados verticalmente com espaçamento consistente

ZONA 5 — BOLA DO DIA (somente se o briefing citar):

Seção dedicada com bola de bingo 3D premium (esférica, iluminada, sombra realista) com o número em negrito. Ao lado: texto da regra da bola do dia em branco, destaque do bônus em dourado bold. Omita completamente se não houver no briefing.

ZONA 6 — PRÊMIO / REGRA ESPECIAL (se houver no briefing):

Box de destaque com valor do bingo em tipografia 3D dourada gigante. Omita se não houver.

ZONA 7 — BASE / CHAMADA FINAL:

Box full-width com borda iluminada. Texto de fechamento do briefing em tipografia premium (cursiva elegante ou display bold). Se o briefing não tiver chamada final, use "BOA SORTE!!!". Pode ter trevo, estrela ou ícone decorativo nas laterais.

==============================

ELEMENTOS DECORATIVOS — USE TODOS

==============================

- Raios de luz (burst) irradiando do centro ou de trás do cabeçalho

- Bolas de bingo numeradas decorativas nos cantos e margens

- Estrelas douradas de 4-6 pontas espalhadas

- Partículas douradas / glitter flutuando no fundo

- Confetes metálicos dourados e da cor da paleta

- Borda geral da arte: linha fina dourada + glow externo

- Cédulas de real estilizadas semi-transparentes (opcional, não dominante)

==============================

TIPOGRAFIA

==============================

- Valores em R$: efeito metálico dourado 3D com highlight branco no topo (aparência cromada)

- Horários: fonte clean moderna bold, branca, contorno fino dourado

- Títulos/dia: display extrabold com sombra profunda e bevel

- Chamada final: pode ser cursiva elegante OU display bold

- TUDO em português brasileiro, sem markdown, sem aspas triplas na imagem

==============================

REGRAS CRÍTICAS

==============================

- NÃO inventar horário, valor, prêmio, regra ou item

- NUNCA cortar, sobrepor ou esconder texto — especialmente horários e valores

- Manter TODOS os dados com precisão absoluta

- Cada arte única — variar fontes, layout e decorações

- Em conflito entre estética e legibilidade: LEGIBILIDADE VENCE

Devolva APENAS a imagem final, sem texto extra.`;
}

export function pickRandomPaleta(): string {
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
}
