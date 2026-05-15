# I.A GX — Construtor de Artes Glorex Prêmios

Site de uma página com chat onde o usuário descreve a programação do dia (horários, valores, bola do dia, prêmios) e a "I.A GX" gera automaticamente uma arte promocional no estilo Novo Glorex usando o modelo Nano Banana (Gemini image), com fundo branco e detalhes laranja-amarelados, sempre incluindo a logo enviada.

## Escopo

- 1 página (`/`) com a logo Novo Glorex no topo, título "I.A GX — Construtor de Artes" e a interface de chat ocupando o restante.
- Chat livre em português, conversa única persistida em `localStorage` (apenas no navegador do usuário).
- Botão "Nova conversa" para limpar o histórico.
- Cada mensagem do bot pode conter texto (perguntas de refinamento) e/ou uma imagem gerada (a arte). Imagens vêm com botão de Download.
- Visual do site: fundo branco, acentos em laranja-amarelado (`#F5A623` / `#FFB800`), tipografia limpa — alinhado ao espírito do material Glorex sem competir com a arte gerada.

## Como a IA funciona

- O chat usa AI SDK + Lovable AI Gateway (`google/gemini-3-flash-preview`) para conversa e refinamento do briefing.
- Quando o usuário fornece os dados da arte (ou pede explicitamente "gerar arte"), o backend chama uma tool `gerar_arte_glorex` que:
  1. Monta um prompt detalhado em português descrevendo: layout vertical estilo flyer, fundo branco com detalhes laranja/amarelo, blocos para horários e valores, destaque da bola do dia, ícones de churrasco/cerveja/airfryer/picanha quando mencionados, slogan "NÃO PERCAM, BOA SORTE!".
  2. Chama o modelo de imagem `google/gemini-3.1-flash-image-preview` (Nano Banana 2) passando como referências visuais: a **logo Novo Glorex** (obrigatória em todas as artes) + as artes-template enviadas (sexta e sábado) + qualquer imagem extra que o usuário enviar depois.
  3. Retorna a imagem gerada (base64/PNG) que aparece dentro da mensagem do assistente.
- O system prompt da IA estabelece a persona "I.A GX", regras (sempre confirmar dados antes de gerar, sempre incluir logo, paleta fixa) e perguntas-padrão (data, horário de abertura, jogadas com hora+valor, bola do dia, prêmios extras, brindes).

## Upload de novas artes-template

- Os assets iniciais (`logo_novo_glorex.png` + as 2 artes enviadas) ficam em `src/assets/` e são embutidos como referência fixa em toda chamada de geração.
- Quando você enviar mais artes via chat (próximas mensagens), eu adiciono ao mesmo diretório e elas passam a ser referência também — sem necessidade de upload pelo usuário final.

## Detalhes técnicos

- **Stack**: TanStack Start (já configurado), AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`), AI Elements (`conversation`, `message`, `prompt-input`, `shimmer`, `tool`), Lovable AI Gateway.
- **Backend**: server route `src/routes/api/chat.ts` com `streamText` + tool `gerar_arte_glorex` (`stepCountIs(50)`). A tool faz `fetch` direto ao endpoint `/chat/completions` do gateway com modelo de imagem e referências em base64, retornando `{ imageDataUrl }`.
- **Frontend**: `src/routes/index.tsx` renderiza header com logo + chat. `useChat` com `id` fixo (`"glorex-chat"`), mensagens carregadas/persistidas em `localStorage` via `onFinish` e bootstrap idempotente. Render por `message.parts` (texto, tool-call em accordion fechado, tool-result com `<img>` da arte + botão download).
- **Assets de referência**: lidos em build como base64 via import `?url` + fetch no servidor, ou pré-codificados em um módulo `src/lib/glorex-references.server.ts`.
- **Empty state**: card com a logo e exemplos de prompt ("Sexta, abertura 18:30, 19h série de 500…").
- **Erros**: toasts para 429 (limite) e 402 (créditos).

## Passos de implementação

1. Habilitar Lovable Cloud (necessário para `LOVABLE_API_KEY` do gateway).
2. Copiar `logo_novo_glorex.png` e as 2 artes-template para `src/assets/` e criar módulo server-only com elas em base64.
3. Definir tokens de cor (laranja/amarelo Glorex) em `src/styles.css`.
4. Instalar AI SDK + AI Elements (`conversation`, `message`, `prompt-input`, `shimmer`, `tool`).
5. Criar `src/lib/ai-gateway.ts` (provider helper) e `src/routes/api/chat.ts` com `streamText` + tool `gerar_arte_glorex`.
6. Implementar `src/routes/index.tsx`: header com logo, chat persistido em localStorage, render de imagens geradas com download, botão "Nova conversa", input focado por padrão.
7. Verificação: gerar duas artes diferentes (ex.: sexta com churrasco/airfryer e sábado com caixa de picanha), conferir presença da logo, fundo branco e paleta laranja/amarelo.
