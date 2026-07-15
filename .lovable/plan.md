Edição cirúrgica em `src/lib/glorex-briefing.ts`, dentro de `buildGlorexImagePrompt`. Nenhum outro arquivo é tocado.

## Mudanças

### 1. STRICT header em inglês no TOPO do prompt
Antes da linha `Crie uma ARTE PROMOCIONAL VERTICAL...`, inserir:

```
STRICT RULE (HIGHEST PRIORITY, OVERRIDES EVERYTHING ELSE):
Render ONLY the text that appears verbatim inside the TRIPLE-QUOTED BRIEFING below.
Any word, letter, number, price, time, slogan, badge, or label that is NOT literally
present in that briefing is FORBIDDEN. Do not invent, complete, translate, or suggest
text. Decorative shapes without text are allowed.
```

Comando curto e imperativo em inglês porque modelos de imagem (Gemini/Nano Banana) obedecem melhor esse formato como âncora inicial.

### 2. Repetir a proibição no FINAL (sanduíche)
O bloco atual "PROIBIÇÃO ABSOLUTA" está no meio (linhas 213-250). Além dele:
- Manter o bloco no meio (já bom).
- Adicionar reforço final logo antes de `Devolva APENAS a imagem final` (linha 270):

```
⛔ CHECAGEM FINAL ANTES DE RENDERIZAR:
Antes de gerar a imagem, releia o briefing entre aspas triplas. Se qualquer texto
que você planeja desenhar NÃO aparece literalmente lá, REMOVA. Sem exceções.
Sem "Oferta Especial", sem "Imperdível", sem valores/horários inventados,
sem números de série, sem chamadas motivacionais.
```

Repetição espaçada (topo + meio + final) é mais eficaz que só mover.

### 3. Purgar gatilhos indutores de texto
Reescrever trechos que hoje literalmente pedem para o modelo inventar texto:

- **Linha 71** (bloco "LIBERDADE"): remover `placas "NOVO", "IMPERDÍVEL", "ÚLTIMA CHANCE"` e trocar "banners de promoção, letreiros luminosos" por "molduras luminosas e frames neon SEM texto adicional".
- **Linha 121** (ZONA 1): remover exemplo `"DIA DAS MÃES", "SEXTA ESPECIAL"` — trocar por "somente se o subtítulo estiver literalmente no briefing".
- **Bloco AUTONOMIA CRIATIVA (linhas 197-211)**: remover `"Um banner ou letreiro luminoso extra de 'chamada' se houver espaço sobrando"`. Substituir por "Camadas visuais extras (partículas, glow, texturas) — nunca texto novo". Deixar explícito que enriquecimento é apenas visual.
- **Bloco ELEMENTOS DECORATIVOS**: sem alterações (já não induz texto).

## Não tocar

- Nenhum outro arquivo.
- `GlorexBriefingSchema`, `selectPaleta`, estrutura das 7 zonas, paleta, tipografia, regras críticas finais.
- Toda a lógica de referências, MCP, `chat.ts`, `image-generation.server.ts`.
