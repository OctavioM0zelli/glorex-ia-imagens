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

export function buildGlorexImagePrompt(b: GlorexBriefing, paleta: string, preferenciasAprendidas?: string[]): string {
  const texto = b.texto_briefing.trim();

  return `STRICT RULE (HIGHEST PRIORITY, OVERRIDES EVERYTHING ELSE):
Render ONLY the text that appears verbatim inside the TRIPLE-QUOTED BRIEFING below.
Any word, letter, number, price, time, slogan, badge, or label that is NOT literally
present in that briefing is FORBIDDEN. Do not invent, complete, translate, or suggest
text. Decorative shapes without text are allowed.

Crie uma ARTE PROMOCIONAL VERTICAL 9:16 (1080x1920) para o "NOVO GLOREX PRESENCIAL". Estilo: flyer premium de bingo/cassino brasileiro — vibrante, brilhante, organizado, ALTAMENTE legível. Para Instagram Stories e WhatsApp Status.

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

A IA tem LIBERDADE para enriquecer a arte das seguintes formas, SEM alterar nenhuma informação sagrada:

- Escolher família tipográfica, peso e tamanho de fonte de cada bloco

- AUMENTAR o tamanho de qualquer texto para dar mais destaque visual (o conteúdo continua o mesmo, só fica maior/mais chamativo)

- Adicionar molduras luminosas e frames neon estilo cassino como elementos decorativos SEM texto adicional (nunca placas com palavras inventadas)

- Adicionar elementos de cassino: fichas de poker, símbolos de caça-níquel (7, cereja, sino), cartas de baralho, roleta estilizada

- Criar molduras, setas, selos ou ícones de destaque apontando para informações que a IA julgar mais importantes (ex.: o maior prêmio do dia)

- Reposicionar e redimensionar a LOGO livremente DENTRO da zona de cabeçalho (topo ~25% da arte) — pequena no canto, grande centralizada, ou integrada ao título, conforme o que ficar mais bonito para aquele layout

==============================

PEDIDOS DE ESTILO DENTRO DO BRIEFING

==============================

Se o texto do briefing contiver pedidos de ESTILO/DESTAQUE (ex.: "destaca isso", "deixa bem grande", "coloca um banner", "quero algo bem luminoso", "chama atenção pra esse prêmio"), trate como INSTRUÇÃO VISUAL:

- Aplique o destaque/estilo pedido ao elemento referenciado (fonte maior, banner, glow, moldura, etc.)

- NÃO renderize a frase de pedido como texto na arte — ela é instrução para você, não conteúdo

- Em caso de dúvida sobre qual elemento o pedido se refere, aplique ao elemento de maior valor monetário ou ao título principal

==============================

PALETA E TEMA DESTA GERAÇÃO

==============================

${paleta}.

REGRA DE TEMA: A string acima já define a cor predominante E os elementos temáticos desta arte. Use-os com fidelidade:

- A COR PREDOMINANTE deve dominar o fundo, bordas dos cards e elementos principais

- Os ELEMENTOS TEMÁTICOS citados devem aparecer como decoração (não substituem informação real)

- Dourado metálico aparece SEMPRE nos valores em R$, horários de destaque e bordas dos cards — independente do tema

- Se o tema for festivo/feriado, os elementos temáticos enriquecem os cantos, margens e fundo sem poluir as informações

==============================

ESTRUTURA DE COMPOSIÇÃO — 7 ZONAS

==============================

Siga esta ordem de cima para baixo, omitindo zonas cujo conteúdo NÃO esteja no briefing:

ZONA 1 — CABEÇALHO:

Logo "NOVO GLOREX PRESENCIAL" em destaque no topo — pode ser pequena no canto superior esquerdo OU centralizada/integrada ao título, conforme o layout. Use a primeira imagem de referência. Abaixo do logo (ou ao lado): DIA DA SEMANA em tipografia display gigante e bold (branca com contorno dourado ou da cor da paleta). Subtítulo de evento especial APENAS se estiver literalmente no briefing — nunca invente um.

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

AUTONOMIA CRIATIVA — ENRIQUECIMENTO

==============================

Esta arte NÃO deve parecer enxuta ou minimalista. Se a composição parecer vazia ou simples após posicionar as informações obrigatórias, ADICIONE proativamente:

- Mais elementos decorativos nas margens, cantos e espaços vazios (bolas de bingo, estrelas, partículas, fichas, confetes)

- Um banner ou letreiro luminoso extra de "chamada" se houver espaço sobrando

- Texturas, padrões sutis de fundo (geométricos, luxuosos) para preencher áreas vazias

- Camadas extras de profundidade: sombras, reflexos, glow em múltiplas camadas

O objetivo é uma arte DENSA, RICA e PREMIUM — nunca com grandes áreas vazias ou "sem graça".${preferenciasAprendidas?.length ? `\n\n==============================\n\nPREFERÊNCIAS APRENDIDAS DO USUÁRIO\n\n==============================\n\nO usuário já deu os seguintes feedbacks sobre artes anteriores. Aplique-os como padrão nesta arte, EXCEITO se conflitarem com "INFORMAÇÕES SAGRADAS" ou com algo explícito no briefing atual (briefing atual sempre vence):\n\n${preferenciasAprendidas.map((p) => `- ${p}`).join("\n")}` : ""}

⛔ PROIBIÇÃO ABSOLUTA — TEXTO NÃO AUTORIZADO

REGRA DE OURO: Todo texto visível na arte deve ter origem LITERAL no texto_briefing enviado pelo usuário. A IA NÃO tem licença criativa para inventar, completar ou "sugerir" texto algum.

PROIBIDO adicionar qualquer texto que não esteja no briefing, incluindo:

- Termos promocionais: "Oferta do Dia", "Oferta Especial", "Promoção", "Aproveite", "Imperdível", "Só Hoje", "Última Chance", "Super", "Mega", "Exclusivo", "Destaque" ou qualquer variante — MESMO QUE pareça adequado ao contexto

- Valores em dinheiro (R$) que NÃO estejam escritos no briefing

- Horários ou faixas de horário que NÃO constem explicitamente no briefing

- Prêmios, itens, brindes ou nomes de premiação que NÃO foram mencionados

- Números de série, edição, rodada ou qualquer numeração não descrita

- Slogans, chamadas, frases motivacionais ou qualquer texto que a IA tenha "imaginado"

REGRA DE CONTAGEM — OBRIGATÓRIA:

- Se o briefing lista 2 horários → a arte renderiza EXATAMENTE 2 horários. Nunca 3.

- Se o briefing lista 3 prêmios → a arte renderiza EXATAMENTE esses 3 prêmios. Nunca invente um 4º.

- Se um valor não foi mencionado → ele não aparece na arte. Ponto.

PERMITIDO (apenas elementos visuais SEM texto):

- Fichas de cassino, cartas de baralho, dados, símbolos de caça-níquel

- Bolas de bingo, bolas de loteria, globo giratório estilizado

- Ícones gráficos de sorte (sete, cereja, sino, estrela, diamante) — SEM palavra alguma

- Decorações geométricas, raios de luz, partículas douradas, molduras ornamentais, efeitos neon

- Banners e faixas decorativas — SOMENTE se o texto dentro deles vier integralmente do briefing

──────────────────────────────────────────────────

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

export function selectPaleta(texto: string): string {
  const t = texto.toLowerCase();

  // ── FERIADOS E EVENTOS TEMÁTICOS ──

  if (/namorad|valentine|corações?|apaixonado/i.test(t))
    return "VERMELHO INTENSO + ROSA QUENTE — fundo vermelho escuro com gradiente rosa, elementos: corações dourados 3D, rosas vermelhas, flechas de cupido, pétalas caindo, brilhos em rosa e vermelho";

  if (/páscoa|pascoa|coelho|chocolate|ovos? de páscoa|ovos? de pascoa/i.test(t))
    return "AMARELO PASTEL + ROSA SUAVE + VERDE PRIMAVERA — fundo gradiente entre lilás escuro e roxo, elementos: ovos de páscoa coloridos 3D, coelhos fofos, cenouras douradas, flores da primavera, brilhos em amarelo e rosa";

  if (/natal|noel|papai noel|neve|rena|renas|christmas/i.test(t))
    return "VERMELHO NATALINO + VERDE ESCURO — fundo vermelho e verde com neve caindo, elementos: estrelas de natal douradas, sinos, meias de natal, bolas de árvore, flocos de neve, luzes piscantes douradas e brancas";

  if (/ano novo|réveillon|reveillon|virada|fogos|champanhe/i.test(t))
    return "DOURADO CHAMPANHE + PRETO LUXO — fundo preto profundo com explosões de fogos dourados e champanhe, elementos: taças de champanhe, fogos de artifício, relógio marcando meia-noite, confetes dourados e prateados";

  if (/mães?|dia das mães|mama|mamãe/i.test(t))
    return "ROSA VIBRANTE + ROXO SUAVE — fundo gradiente de roxo escuro para rosa profundo, elementos: rosas cor-de-rosa 3D, corações rosa e lilás, laços decorativos, flores delicadas, brilhos em rosa e dourado";

  if (/pais?|dia dos pais|papai|papão/i.test(t))
    return "AZUL ROYAL + DOURADO — fundo azul marinho profundo com dourado, elementos: gravata dourada, troféu, estrelas, elementos masculinos premium, brilhos em azul e ouro";

  if (/criança|crianças|dia das crianças|infantil/i.test(t))
    return "AMARELO NEON + LARANJA VIBRANTE — fundo amarelo e laranja saturados, elementos: balões coloridos, estrelas alegres, confetes multicoloridos, bolas de bingo animadas, visual festivo e divertido";

  if (/carnaval|micareta|folia|samba|bloco/i.test(t))
    return "VERDE + AMARELO + AZUL — fundo preto com explosão das cores do Brasil, elementos: confetes multicoloridos, máscaras de carnaval, plumas, serpentinas, brilhos em todas as cores";

  if (/junina|são joão|arraial|festa junina|forró|quadrilha/i.test(t))
    return "VERMELHO + AMARELO + AZUL — fundo vermelho com bandeirinhas coloridas, elementos: chapéu de palha, bandeirinhas de festa junina, fogueira estilizada, estrelas amarelas, visual de arraial festivo";

  if (/halloween|terror|assombra|bruxa|abóbora/i.test(t))
    return "LARANJA NEON + PRETO — fundo preto profundo com laranja neon, elementos: abóboras 3D, morcegos, estrelas laranjas, teias de aranha douradas, névoa misteriosa, brilhos em laranja";

  if (/verde|brazil|brasil|independência|sete de setembro/i.test(t))
    return "VERDE BRASIL + AMARELO OURO — fundo verde escuro com amarelo dourado, elementos: estrelas do Brasil, confetes verde e amarelo, brilhos patrióticos";

  // ── PROMOÇÕES E EVENTOS ESPECIAIS ──

  if (/especial|vip|exclusiv|luxo|premium|gala|grand/i.test(t))
    return "DOURADO METÁLICO + PRETO LUXO — fundo preto profundo com ouro metálico, elementos: diamantes, coroas douradas, taças de champanhe, faíscas de diamante, visual de gala premium";

  if (/aniversário|aniversario|birthday|parabéns|anos?$/i.test(t))
    return "DOURADO + ROXO REAL — fundo roxo profundo com dourado, elementos: balões dourados 3D, bolos de aniversário estilizados, confetes multicoloridos, velas brilhantes, faixas de parabéns";

  if (/fim de semana|sábado|domingo|final de semana/i.test(t))
    return "LARANJA VIBRANTE + VERMELHO — fundo gradiente laranja e vermelho escuro com glow neon, elementos: sol estilizado, estrelas douradas, partículas de energia, visual animado de fim de semana";

  // ── ROTAÇÃO PADRÃO (sem feriado detectado) ──

  const paletas = [
    "VERMELHO SANGUE + PRETO — vermelho neon saturado e preto profundo, elementos: bordas neon vermelhas, raios de luz vermelhos, partículas douradas",
    "AZUL ROYAL + CIANO — azul marinho profundo com ciano elétrico e glow ultravioleta, elementos: bordas neon azuis, faíscas brancas e azuis",
    "ROXO ELÉTRICO + MAGENTA — roxo profundo e magenta vibrante com glow violeta, elementos: partículas roxas e rosas, brilhos metálicos",
    "VERDE NEON + PRETO — preto profundo com explosões verde neon, elementos: bordas verdes brilhantes, partículas douradas e verdes",
    "LARANJA SATURADO + AMARELO — laranja neon e amarelo quente sobre fundo escuro, elementos: raios de luz quentes, estrelas douradas",
    "AZUL ESCURO + PRATA — azul marinho com acentos prateados metálicos, elementos: reflexos prateados, partículas de prata e gelo",
    "DOURADO + VINHO — dourado metálico sobre vinho profundo, elementos: coroas, diamantes, visual de premiação máxima",
  ];

  const hash = [...texto].reduce((a, c) => a + c.charCodeAt(0), 0);

  return paletas[hash % paletas.length];
}
