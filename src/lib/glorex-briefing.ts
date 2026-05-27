// Schema estruturado do briefing das artes do Novo Glorex Presencial.
// Fonte única usada pela tool do chat (/api/chat) e pela rota direta
// (/api/generate-image). Inclui o builder determinístico do prompt final.

import { z } from "zod";

export const GlorexEventoTipo = z.enum([
  "rodada_bingo",
  "sorteio",
  "premiacao_item",
  "evento",
]);

export const GlorexEventoSchema = z.object({
  horario: z.string().min(1).describe("Horário do evento, ex: '19:00'."),
  tipo: GlorexEventoTipo.default("evento").describe(
    "Classificação do evento. 'rodada_bingo' (dinheiro + bingo), 'sorteio' (palavra sorteio), 'premiacao_item' (item físico) ou 'evento' (descrição livre).",
  ),
  conteudo: z
    .string()
    .default("")
    .describe(
      "Descrição livre do evento. Opcional quando há valor que já descreve a rodada (ex.: rodada de bingo só com valor). Ex.: 'Série 4 reais', '2° sorteio', 'Caixa de picanha', 'Balão premiado'.",
    ),
  valor: z
    .string()
    .optional()
    .describe("Só quando há dinheiro envolvido, ex.: 'R$ 400'. Omita se não houver valor."),
  observacao: z
    .string()
    .optional()
    .describe("Observação adicional opcional (série, condição, detalhe extra)."),
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
  programacao: z.array(GlorexEventoSchema).min(1).max(12),
  dia_numero: z
    .string()
    .min(1)
    .describe("Número da bola do dia / dia em destaque central, ex: '20'."),
  regra_especial: z
    .string()
    .optional()
    .describe("Regra especial ligada à bola do dia."),
  premio_extra: z
    .string()
    .optional()
    .describe("Prêmio extra da regra especial, ex: 'R$ 2.300'."),
  condicao_extra: z
    .string()
    .optional()
    .describe("Condição complementar, ex: 'Para quem bater o bingo com a série completa.'"),
  observacao_progressiva: z
    .string()
    .optional()
    .describe("Observação geral/progressiva opcional sobre a programação do dia."),
  chamada_final: z
    .string()
    .default("NÃO PERCAM!!! BOA SORTE!!!")
    .describe("Chamada final impactante da arte."),
});

export type GlorexBriefing = z.infer<typeof GlorexBriefingSchema>;
export type GlorexEvento = z.infer<typeof GlorexEventoSchema>;

// ---------------------------------------------------------------------------
// Builder determinístico do prompt final enviado ao Nano Banana.
// ---------------------------------------------------------------------------

function describeEventoLine(e: GlorexEvento): string {
  // Renderiza APENAS conteúdo real — sem rótulos de coluna ("observação",
  // "conteúdo", "tipo" NUNCA devem aparecer renderizados na arte).
  const partes: string[] = [];
  switch (e.tipo) {
    case "rodada_bingo":
      if (e.valor) partes.push(`PRÊMIO ${e.valor}`);
      if (e.conteudo) partes.push(e.conteudo);
      if (e.observacao) partes.push(e.observacao);
      return `   ${e.horario}  ⏰  ${partes.join(" — ")}  [tipo: rodada de bingo — valor "${e.valor ?? ""}" em DOURADO 3D gigante, resto em branco]`;
    case "sorteio":
      partes.push("SORTEIO");
      if (e.conteudo) partes.push(e.conteudo);
      if (e.valor) partes.push(e.valor);
      if (e.observacao) partes.push(e.observacao);
      return `   ${e.horario}  ⏰  ${partes.join(" — ")}  [tipo: sorteio — "SORTEIO" em destaque, conteúdo em branco grande, valor em dourado se houver]`;
    case "premiacao_item":
      if (e.conteudo) partes.push(e.conteudo);
      if (e.valor) partes.push(e.valor);
      if (e.observacao) partes.push(e.observacao);
      return `   ${e.horario}  ⏰  ${partes.join(" — ")}  [tipo: premiação de item físico — ilustrar o item (${e.conteudo || "item"}) de forma realista e premium, texto em branco grande, NÃO inventar valor]`;
    case "evento":
    default:
      if (e.conteudo) partes.push(e.conteudo);
      if (e.valor) partes.push(e.valor);
      if (e.observacao) partes.push(e.observacao);
      return `   ${e.horario}  ⏰  ${partes.join(" — ")}  [tipo: evento — linha sóbria em branco, sem dourado, sem inventar valor]`;
  }
}

export function buildGlorexImagePrompt(b: GlorexBriefing, paleta: string): string {
  const programacaoLinhas = b.programacao.map(describeEventoLine).join("\n");

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

  const blocoObsProg = b.observacao_progressiva
    ? `Observação geral da programação (renderizar discreta, em branco, sem dourado): "${b.observacao_progressiva}".`
    : "";

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
- NUNCA renderizar rótulos de campo do JSON ("observação", "conteúdo", "tipo", "valor"). Mostrar SÓ o conteúdo real.

==============================
ESTRUTURA FIXA EM 6 BLOCOS
==============================

1) BLOCO SUPERIOR ESQUERDO — selo/logo "NOVO GLOREX PRESENCIAL" pequeno no canto.

2) BLOCO SUPERIOR PRINCIPAL — título do dia/evento "${b.dia_da_semana_evento}" com GRANDE destaque no topo (centro/direita). ${blocoOferta}

3) BLOCO DE PROGRAMAÇÃO — começa com "ABERTURA ${b.horario_abertura}" em destaque. Depois, lista a programação em LINHAS HORIZONTAIS, uma por linha, com ícone de RELÓGIO ao lado do horário. Horários SEMPRE alinhados na lateral ESQUERDA.

REGRA DE OURO DA PROGRAMAÇÃO:
- A programação é MISTA: pode ter rodadas de bingo com prêmio em dinheiro, sorteios, premiações de itens físicos (caixa de picanha, balão premiado, cesta, brinde) e eventos sem valor.
- Horário SEM valor em dinheiro é VÁLIDO e deve aparecer fielmente — NÃO inventar prêmios, NÃO transformar sorteio em rodada com valor, NÃO descartar a linha.
- Cada linha mostra apenas o conteúdo real (sem rótulos de coluna).
- Estilizar cada linha de acordo com o tipo indicado entre colchetes.

Programação desta arte:
${programacaoLinhas}
${blocoObsProg ? `\n${blocoObsProg}` : ""}

4) BLOCO CENTRAL DE DESTAQUE — texto "DIA ${b.dia_numero}" em GRANDE destaque (número em dourado/amarelo), com uma BOLA DE BINGO GIGANTE central mostrando o número "${b.dia_numero}". Ao redor, bolas decorativas menores numeradas.

5) BLOCO DE REGRA ESPECIAL — ${blocoRegra}

6) BLOCO FINAL/CHAMADA — frase final chamativa "${b.chamada_final}" fechando a arte com bastante impacto visual (tipografia gigante, dourado/amarelo + branco). Se a chamada tiver duas partes (ex.: "NÃO PERCAM!!! / BOA SORTE!!!"), distribua em DUAS LINHAS.

==============================
ELEMENTOS DECORATIVOS
==============================
Bolas de bingo numeradas, cédulas de dinheiro brasileiro (R$), brilhos, estrelas, confetes, molduras iluminadas, faíscas, partículas luminosas. Visual forte e comercial, sem ficar bagunçado.

==============================
PREMIAÇÕES FÍSICAS (quando citadas)
==============================
Ilustre item físico (airfryer, frigobar, kit churrasco, picanha, cervejas, carnes, caixa de picanha, balão premiado, cesta) de forma REALISTA e PREMIUM, bem iluminado e apetitoso. NUNCA usar marcas reais.

==============================
REGRAS CRÍTICAS
==============================
- NÃO inventar horários, valores, prêmios ou regras.
- Horário sem valor em dinheiro NÃO é erro — é programação válida (sorteio, brinde, evento).
- Manter TODOS os horários, números e valores EXATAMENTE como enviados.
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
