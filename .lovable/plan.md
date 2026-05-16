## Objetivo

Dar ao usuário controle sobre a geração:
1. **Parar** — interromper enquanto a I.A está gerando (texto ou arte).
2. **Gerar novamente** — refazer a última arte com o mesmo briefing, sem precisar redigitar.

## Mudanças

### 1. `src/routes/api/chat.ts`
- Passar `abortSignal: request.signal` para `streamText` — sem isso, mesmo o usuário "parando" no front, o servidor continua rodando o loop de tools (e queimando cota do Google + tempo de resposta de imagem).

### 2. `src/routes/index.tsx`

**Stop:**
- Extrair `stop` de `useChat`.
- No formulário (botão de envio), quando `isLoading` for `true`, trocar o ícone `Send`/`Loader2` por um ícone de parar (`Square` do lucide) com `type="button"` e `onClick={stop}`. Tooltip "Parar geração".
- Mostrar o botão Parar desde `status === "submitted"` (antes do primeiro token), não só durante `streaming` — assim dá pra cancelar a chamada de imagem (que demora até 2 min) imediatamente.

**Gerar novamente:**
- Adicionar botão "Gerar novamente" no card da arte (`ArteToolPart`), ao lado de "Apagar" e "Baixar".
- Ao clicar:
  - Procurar, nas mensagens anteriores, a última mensagem do usuário que veio antes desta arte (briefing original).
  - Chamar `sendMessage({ text: "Gere novamente a mesma arte, com nova variação de paleta e layout. Briefing: <texto da última mensagem do usuário>" })`.
  - Desabilitar o botão enquanto `isLoading`.
- Ficar visível apenas em artes com `output.ok === true` (sucesso).

## Out of scope
- Não mexer em persistência (o `useChat` já mantém as partes parciais em memória; ao parar no meio de uma arte, o card de loading some e o usuário pode digitar de novo).
- Sem retry automático em falha — só botão manual disparado pelo usuário.
- Sem mudança no design tokens / paleta.

## Risco
Baixo. `stop()` é API nativa do `useChat`. O `abortSignal` pode demorar alguns segundos pra abortar a chamada do Google se ela já estiver em flight (o `fetch` interno respeita o signal, então o timeout efetivo cai).
