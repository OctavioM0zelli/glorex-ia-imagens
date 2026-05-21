## Objetivo

Aplicar o novo briefing visual do Novo Glorex à pipeline de geração de imagens, mantendo as regras fixas da memória do projeto (logo pequena, cor predominante, branco como cor base de texto).

## Decisões confirmadas

- **Logo**: continua **pequena (~15-18%)** no canto superior esquerdo (mantém memória; o "grande e bem visível" do briefing vira "bem nítida e legível, sem dominar").
- **Referências**: passar a usar as **últimas N artes do bucket inteiro** (`glorex-generated-images`) como contexto de aprendizado contínuo.
- **Normalização de texto**: dupla camada — o chat (Gemini text) reorganiza semanticamente o briefing; uma função determinística no servidor garante formatação de moeda (`R$ 1.000`), capitalização e limpeza antes de montar o prompt da imagem.

## Mudanças

### 1. `src/lib/image-generation.server.ts`
- Adicionar `listRecentBucketArts(limit = 5)`: usa `supabaseAdmin.storage.from("glorex-generated-images").list()` ordenado por `created_at desc`, retorna URLs públicas via `getPublicUrl`.
- Adicionar `fetchBucketArtsAsInline(limit, abortSignal)`: chama o anterior e baixa cada URL como `inline_data` (reusa `fetchUrlAsInline`).
- Adicionar `normalizeBriefingText(input)`: utilitário puro que:
  - converte números soltos em moeda (`"400"` → `"R$ 400"`, `"1.000"` → `"R$ 1.000"`, `"2300"` → `"R$ 2.300"`) — heurística aplicada a campos `descricao`, `premioBingo`;
  - corrige espaçamento, pontuação básica, capitaliza início de frase;
  - normaliza horários (`"19h"` → `"19:00"`, `"19h30"` → `"19:30"`).
- Tornar o número de refs do bucket configurável via `GLOREX_BUCKET_REFS_LIMIT` (default 5).

### 2. `src/routes/api/chat.ts`
- **System prompt**: ampliar com a "Estrutura fixa" do novo briefing (6 blocos), as regras de texto (auto-correção, moeda BRL, fidelidade ao conteúdo) e a regra de destaque (branco padrão + amarelo/dourado para valores, horários importantes, palavra-chave, número da bola).
- **Tool `gerar_arte_glorex`**:
  - Antes de montar o `promptText`, passar `input` por `normalizeBriefingText` para padronizar moeda/horários/typos.
  - Reescrever o `promptText` para refletir a **estrutura fixa em 6 blocos** (cabeçalho com logo pequena + título do dia / box de oferta se houver / bloco de horários alinhados / bloco central "DIA XX" + bola gigante / bloco de regra especial / chamada final).
  - Reforçar: branco como cor padrão; amarelo/dourado SOMENTE em valores de prêmio, horários importantes, número da bola, chamada final.
  - **Coletar referências**: além das 6 refs fixas em `public/glorex` e das artes da sessão, adicionar as **últimas N artes do bucket** via `fetchBucketArtsAsInline`. Ordem no array `parts`: prompt → logo → 6 templates fixos → últimas do bucket → artes da sessão atual.
  - Manter o aborto cooperativo (`abortSignal`) nessa nova fase.

### 3. `src/routes/api/generate-image.ts`
- Aplicar a mesma `normalizeBriefingText` ao prompt recebido diretamente, para manter paridade entre os dois caminhos.
- Opcional: incluir também as últimas refs do bucket nesse endpoint (mesma função utilitária).

### 4. Memória do projeto
- Adicionar memória nova `mem://design/estrutura-fixa.md` descrevendo os 6 blocos e as regras de cor de texto (branco padrão + dourado em destaques).
- Atualizar `mem://index.md` para referenciá-la (manter as memórias existentes intactas).

## Fora do escopo

- Não mudar tamanho da logo (memória mantida).
- Não criar Supabase Edge Function (já decidido).
- Não criar tabela de "artes curadas" — usar diretamente as mais recentes do bucket.
- Sem alterações de UI no `index.tsx`.

## Riscos

- `storage.list()` pode retornar muitos arquivos; limitamos via `limit` + ordenação. Se o bucket crescer muito, paginar.
- Mandar muitas imagens (6 fixas + 5 bucket + até 5 sessão = 16) pode estourar payload do Gemini. Vou cap em 5 bucket + 3 sessão como default conservador, configurável por env.
