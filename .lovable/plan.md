# Atualizar prompt do Gemini para artes Novo Glorex premium

## Problema
O prompt atual em `src/routes/api/chat.ts` está produzindo artes genéricas. O usuário forneceu um briefing muito mais detalhado (estética neon/cassino, hierarquia, regras de layout, lista expandida de elementos visuais e premiações).

## Mudanças

**Arquivo único:** `src/routes/api/chat.ts`

### 1. Expandir a lista de paletas
Substituir as 5 paletas atuais pelas 7 do briefing, mantendo o sorteio aleatório a cada geração:
- vermelho + preto
- roxo + rosa
- azul + roxo
- verde neon + preto
- dourado + vermelho
- laranja + amarelo
- azul neon + preto

Cada paleta descrita como "saturada, vibrante, neon/luxuosa".

### 2. Reescrever `promptText`
Trocar o texto atual pelo novo briefing, mantendo a interpolação dos campos da tool (`input.dia`, `input.abertura`, `input.jogadas`, `input.bolaDoDia`, `input.premioBingo`, `input.slogan`, `input.observacoes`). Estrutura nova:

- **Estilo geral**: ultra vibrante, neon, glow, 3D, tipografia gigante, mistura cassino/bingo/sorteio noturno, contraste forte, layout dinâmico com caixas e molduras luminosas.
- **Identidade visual**: logo "Novo Glorex Presencial" no topo, grande, com glow e profundidade (referenciando a imagem de logo enviada).
- **Paleta da geração**: injetar a paleta sorteada.
- **Tipografia**: enorme, negrito, 3D, branco/dourado/amarelo neon/azul neon/vermelho intenso, contorno e sombra fortes. Título do dia (ex.: "${input.dia}") domina a composição.
- **Estrutura em blocos** (de cima para baixo):
  1. Cabeçalho com logo + dia/evento.
  2. Faixa "ABERTURA ${input.abertura}".
  3. Linhas horizontais de horários e prêmios — horários SEMPRE alinhados à esquerda, cada um colado ao prêmio correto, sem nada cobrindo. Listar `input.jogadas`.
  4. Destaque da BOLA DO DIA (`input.bolaDoDia`) — bola gigante com brilho intenso na área central.
  5. Quando houver `input.premioBingo`, bloco explicativo do prêmio extra.
  6. Rodapé com `input.slogan` em destaque.
- **Elementos visuais obrigatórios**: bolas de bingo gigantes com números, relógios ao lado dos horários, dinheiro brasileiro voando, confetes, estrelas, luzes neon, faíscas, partículas, fumaça colorida, efeitos cassino.
- **Premiações físicas** (quando citadas em jogadas/observações): ilustrar de forma realista e premium — airfryer com carnes nobres, frigobar com cervejas, caixa de picanha, kit churrasco, churrasco apetitoso. Estilo "anúncio comercial luxuoso". Sem marcas reais.
- **Efeitos**: glow neon, reflexos, profundidade, iluminação cinematográfica, sombras intensas, brilhos metálicos, gradientes fortes, contornos luminosos.
- **Clima**: emoção, urgência, sorte, riqueza, energia de cassino/bingo moderno.
- **Regras críticas** (mantidas e reforçadas):
  - Nenhum texto cortado, coberto ou sobreposto. Cada info tem seu espaço.
  - Horários nunca cobertos por caixas/imagens.
  - Não inventar dados além dos fornecidos.
  - Manter horários, números e valores exatamente como enviados.
  - Sem marcas famosas reais nos produtos.
  - Tudo em português brasileiro.
  - Cada arte ÚNICA — variar disposição, decoração e enquadramento em relação às artes anteriores enviadas como referência; usar paleta diferente da última.
  - Formato vertical 1080x1920 (9:16), pensado para Instagram Stories e WhatsApp Status.
- Fechar com "Devolva APENAS a imagem final, sem texto extra."

### 3. Não mexer
- Logo + 8 templates + artes anteriores continuam sendo enviados como `inline_data` (já funciona).
- Modelo (`gemini-3-pro-image-preview`), aspect ratio 9:16, timeout, tratamento de erros, abort signal — sem alteração.
- Schema da tool, fluxo de chamada, persistência — sem alteração.

## Risco
Baixo. É edição de string de prompt + array de paletas. Sem impacto em tipos, schema ou fluxo de rede.