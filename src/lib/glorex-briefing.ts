// Schema estruturado do briefing das artes do Novo Glorex Presencial.
// Fonte única usada pela tool do chat (/api/chat) e pela rota direta
// (/api/generate-image). Inclui o builder determinístico do prompt final
// (Etapa 2 do pipeline: parser → builder → Nano Banana).

import { z } from "zod";

export const GlorexRodadaSchema = z.object({
  horario: z.string().min(1).describe("Horário da rodada, ex: '19:00'."),
  premio: z.string().min(1).describe("Prêmio da rodada, ex: 'R$ 400'."),
  observacao: z
    .string()
    .optional()
    .describe("Observação opcional da rodada, ex: 'Série 4' ou 'Kit churrasco'."),
});

export const GlorexBriefingSchema = z.object({
  dia_da_semana_evento: z
    .string()
    .min(1)
    .describe("Dia da semana e/ou data do evento, ex: 'Quarta' ou 'Sexta — dia 15'."),
  oferta_topo: z
    .string()
    .optional()
    .describe("Oferta destacada no topo, ex: '50% em todo o cardápio para consumo local.'"),
  horario_abertura: z.string().min(1).describe("Horário de abertura, ex: '18:30'."),
  rodadas: z.array(GlorexRodadaSchema).min(1).max(12),
  dia_numero: z
    .string()
    .min(1)
    .describe("Número da bola do dia / dia em destaque central, ex: '20'."),
  regra_especial: z
    .string()
    .optional()
    .describe(
      "Regra especial ligada à bola do dia, ex: 'Nas jogadas anunciadas, quem bater o bingo com a bola 20 ganha prêmio de bingo mais R$ 2.300.'",
    ),
  premio_extra: z
    .string()
    .optional()
    .describe("Prêmio extra da regra especial, ex: 'R$ 2.300'."),
  condicao_extra: z
    .string()
    .optional()
    .describe("Condição complementar, ex: 'Para quem bater o bingo com a série completa.'"),
  chamada_final: z
    .string()
    .default("NÃO PERCAM!!! BOA SORTE!!!")
    .describe("Chamada final impactante da arte."),
});

export type GlorexBriefing = z.infer<typeof GlorexBriefingSchema>;
export type GlorexRodada = z.infer<typeof GlorexRodadaSchema>;

// ---------------------------------------------------------------------------
// Builder determinístico do prompt final enviado ao Nano Banana.
// Mesma fonte de verdade para o chat e para a rota direta.
// ---------------------------------------------------------------------------

export function buildGlorexImagePrompt(b: GlorexBriefing, paleta: string): string {
  const rodadasLinhas = b.rodadas
    .map((r) => {
      const obs = r.observacao ? ` — ${r.observacao}` : "";
      return `   ${r.horario} — ${r.premio}${obs}`;
    })
    .join("\n");

  const blocoOferta = b.oferta_topo
    ? `Logo abaixo do título, em BOX DESTACADO bem visível no topo: "${b.oferta_topo}".`
    : "";

  const blocoRegra = b.regra_especial
    ? `Texto da regra: "${b.regra_especial}".${
        b.premio_extra
          ? ` O valor "${b.premio_extra}" deve ser o MAIOR destaque visual deste bloco (tipografia 3D dourada gigante, glow, sombra forte).`
          : ""
      }${
        b.condicao_extra
          ? ` Logo abaixo, em destaque secundário bem claro: "${b.condicao_extra}".`
          : ""
      }`
    : "Omita este bloco se não houver regra especial.";

  return `Crie uma ARTE PROMOCIONAL VERTICAL 9:16 (1080x1920) para o "NOVO GLOREX PRESENCIAL". Estilo flyer brasileiro popular-premium de BINGO / SORTEIO / CASSINO: vibrante, brilhante, organizada, ALTAMENTE LEGÍVEL. Pensada para Instagram Stories e WhatsApp Status.

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

2) BLOCO SUPERIOR PRINCIPAL — título do dia/evento "${b.dia_da_semana_evento}" com GRANDE destaque, dominando o topo (centro/direita). ${blocoOferta}

3) BLOCO DE HORÁRIOS — começa com "ABERTURA ${b.horario_abertura}" em destaque. Depois, lista as rodadas em LINHAS HORIZONTAIS, uma por linha, com ícone de RELÓGIO ao lado do horário. Horários SEMPRE alinhados na lateral ESQUERDA. Cada linha: horário + prêmio + observação se existir. Prêmios em tipografia 3D destacada (extrusão, contorno grosso, sombra, glow). Rodadas:
${rodadasLinhas}

4) BLOCO CENTRAL DE DESTAQUE — texto "DIA ${b.dia_numero}" em GRANDE destaque (número em dourado/amarelo), com uma BOLA DE BINGO GIGANTE central mostrando o número "${b.dia_numero}". Ao redor, bolas decorativas menores numeradas.

5) BLOCO DE REGRA ESPECIAL — ${blocoRegra}

6) BLOCO FINAL/CHAMADA — frase final chamativa "${b.chamada_final}" fechando a arte com bastante impacto visual (tipografia gigante, dourado/amarelo + branco). Se a chamada tiver duas partes (ex.: "NÃO PERCAM!!! / BOA SORTE!!!"), distribua em DUAS LINHAS.

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
}

// Paleta randômica — extraída para reuso entre chat e rota direta.
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
