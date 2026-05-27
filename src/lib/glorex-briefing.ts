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

  return `Crie uma ARTE PROMOCIONAL VERTICAL 9:16 (1080x1920) para o "NOVO GLOREX PRESENCIAL". Estilo flyer brasileiro popular-premium de BINGO / SORTEIO / CASSINO: vibrante, brilhante, organizada, ALTAMENTE LEGÍVEL. Pensada para Instagram Stories e WhatsApp Status.

==============================
BRIEFING DO FUNCIONÁRIO (FONTE ÚNICA DA VERDADE)
==============================
Siga FIELMENTE a estrutura, ordem e conteúdo do texto abaixo. Não invente, não omita, não reordene, não traduza. Todo horário, valor, nome, regra e palavra deve aparecer EXATAMENTE como está aqui:

"""
${texto}
"""

Interprete o texto com bom senso brasileiro de flyer de bingo:
- Cada linha/horário do texto vira uma linha visual da programação, na MESMA ordem.
- Quando houver valor em R$, ele é o destaque dourado daquela linha.
- Quando houver só descrição (sorteio, item físico, evento), mostre apenas a descrição em branco grande, SEM inventar valor.
- Quando o texto citar item físico (picanha, cesta, balão premiado, airfryer, frigobar, kit churrasco, etc.), ILUSTRE o item de forma realista e premium, sem usar marcas reais.
- Se houver "regra especial / bola do dia / prêmio extra", coloque em bloco de destaque com o valor em tipografia 3D dourada gigante.
- Se houver oferta no topo (ex.: "30% de desconto no cardápio"), coloque em box destacado logo abaixo do título.
- Termine com a chamada final que estiver no texto; se não houver, use "NÃO PERCAM!!! BOA SORTE!!!".

==============================
IDENTIDADE VISUAL — LOGO
==============================
LOGO "NOVO GLOREX PRESENCIAL" SEMPRE no CANTO SUPERIOR ESQUERDO, em tamanho PEQUENO/COMPACTO (~15-18% da largura), nítida e bem visível, mas NUNCA grande, NUNCA centralizada, NUNCA dominando a composição. Use a PRIMEIRA imagem de referência como base do logo.

==============================
PALETA DESTA GERAÇÃO
==============================
${paleta}. Cores SATURADAS, NEON, LUXUOSAS. Fundo ESCURO, vibrante e contrastante, com brilhos, bordas iluminadas, clima festivo/premiação.

REGRA DE COR PREDOMINANTE:
- Escolha UMA cor predominante (da paleta acima) e use ela na MAIORIA dos elementos.
- Dourado/prata aparecem só em destaques.
- Use paleta DIFERENTE das últimas artes enviadas como referência.

==============================
REGRA DE TEXTO E DESTAQUE
==============================
- COR PADRÃO DO TEXTO = BRANCO PURO, com contorno escuro e sombra para contraste sobre o fundo escuro.
- AMARELO/DOURADO apenas para destaques: valores de prêmio (R$), horários importantes, número da bola do dia, palavra "SORTEIO" e chamada final.
- Tipografia GRANDE, LIMPA, IMPACTANTE, em NEGRITO, com aparência 3D nos prêmios em dinheiro.
- Texto NUNCA pode ficar confuso, cortado, sobreposto ou mal distribuído.
- TUDO em PORTUGUÊS BRASILEIRO.
- NUNCA renderize aspas triplas, marcadores de markdown, rótulos técnicos ou nomes de campo — só o conteúdo real do briefing.

==============================
ESTRUTURA VISUAL DE REFERÊNCIA (6 BLOCOS)
==============================
Use como guia de composição, adaptando ao conteúdo real do briefing acima:
1) Topo esquerdo: logo pequena.
2) Topo: título do dia/evento + (se houver) box de oferta.
3) Meio-cima: "ABERTURA HH:MM" + programação em linhas horizontais, ícone de relógio ao lado de cada horário, horários alinhados à esquerda.
4) Centro: bola de bingo gigante com o número da bola do dia (quando o briefing citar), cercada de bolas decorativas.
5) Meio-baixo: bloco de regra especial / prêmio extra (quando o briefing citar).
6) Base: chamada final em tipografia gigante, dourado + branco.

Se o briefing não citar algum desses blocos, simplesmente OMITA — não invente conteúdo para preencher.

==============================
ELEMENTOS DECORATIVOS
==============================
Bolas de bingo numeradas, cédulas de dinheiro brasileiro (R$), brilhos, estrelas, confetes, molduras iluminadas, faíscas, partículas luminosas. Visual forte e comercial, sem ficar bagunçado.

==============================
REGRAS CRÍTICAS
==============================
- NÃO inventar horários, valores, prêmios, regras ou itens.
- Horário sem valor em dinheiro NÃO é erro — é programação válida (sorteio, brinde, evento).
- Manter TODOS os horários, números e valores EXATAMENTE como no briefing.
- NÃO cortar, cobrir ou sobrepor textos — especialmente os HORÁRIOS na coluna esquerda.
- Cada arte ÚNICA — varie disposição e decoração; cor predominante DIFERENTE da última.
- Priorize CLAREZA. Em conflito entre estética e clareza, vence a clareza.

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
