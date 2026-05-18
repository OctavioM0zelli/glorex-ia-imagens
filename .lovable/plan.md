## Diagnóstico

### 1. Botão "Parar" não interrompe de verdade
- O `stop()` do `useChat` cancela o fetch do cliente e o `streamText` no servidor (já está com `abortSignal: request.signal`).
- **Mas** a tool `gerar_arte_glorex` faz um `fetch` próprio pra API do Google (até 150s) com um `AbortController` só de timeout. Esse fetch **não recebe** o sinal de abort do request — então quando o usuário aperta Parar durante a geração de imagem, o servidor continua esperando o Google responder e a UI demora pra "soltar".
- A tool do AI SDK recebe um `abortSignal` no segundo parâmetro do `execute` que precisa ser encadeado.

### 2. Bloquear mais de 1 geração simultânea
- Hoje o submit é bloqueado por `isLoading` (que cobre `submitted`/`streaming`). Isso funciona pro botão, mas não impede teoricamente uma segunda chamada se o estado piscar. Falta também uma trava semântica "tem uma arte em andamento".

### 3. Botão "Nova conversa"
- Hoje só limpa as **mensagens** (`STORAGE_KEY`). **Não** apaga as artes salvas (`ARTS_KEY`), **não** chama `stop()` se houver geração em andamento e **não** reseta o contador de memória de artes.

### 4. Modelo Nano Banana 2 (versão intermediária)
- Verificado em `src/routes/api/chat.ts:26`: `GOOGLE_IMAGE_MODEL = "gemini-3.1-flash-image-preview"` → este **é** o "Nano Banana 2 Flash", a versão **intermediária** (entre o `gemini-2.5-flash-image` antigo e o `gemini-3-pro-image-preview`). Está correto. Sem mudança aqui — só vou reforçar no comentário do código.

---

## Plano

### Mudanças em `src/routes/api/chat.ts`

1. **Encadear o abort signal até o Google**
   - Em `callGoogleImageOnce`, aceitar um `parentSignal?: AbortSignal` opcional. Criar o `AbortController` interno (pro timeout) e escutar o `parentSignal` pra também abortar.
   - Propagar pelo `callGoogleImage`.
   - No `execute` da tool `gerar_arte_glorex`, capturar o segundo argumento `{ abortSignal }` e passar adiante. Antes do fetch e entre etapas, checar `abortSignal?.aborted` e retornar cedo com `{ ok: false, category: "aborted", error: "Geração cancelada pelo usuário." }`.
   - Tratar `AbortError` no `catch` retornando o mesmo resultado "aborted" (sem logar como falha do Google).

2. **Categoria nova `aborted`**
   - Adicionar `"aborted"` ao union de `category`.
   - No `toModelOutput`, quando `category === "aborted"`, devolver uma frase curta tipo "Geração cancelada pelo usuário." (o LLM normalmente nem vai ter chance de responder porque o stream também aborta, mas garante consistência).

### Mudanças em `src/routes/index.tsx`

3. **Stop button mais responsivo + trava de concorrência**
   - Computar `hasArtInFlight` a partir de `messages`: existe alguma `tool-gerar_arte_glorex` cujo `state` ainda não é `output-available`/`output-error`. Combinar com `isLoading` num único `isBusy`.
   - `handleSubmit` bloqueia se `isBusy`.
   - O botão de Parar fica visível enquanto `isBusy` (cobre tanto "pensando" quanto "gerando arte").
   - Ao clicar Parar: chamar `stop()` e, defensivamente, marcar qualquer tool-call ainda pendente como `output-available` com `{ ok: false, category: "aborted", error: "Geração cancelada pelo usuário." }` via `setMessages`, pra UI refletir imediatamente mesmo se o servidor demorar um tick a mais.

4. **Botão "Nova conversa" robusto**
   - Trocar `handleNewChat` por uma versão que:
     1. Se `isBusy`, chama `stop()` primeiro.
     2. Limpa `STORAGE_KEY` **e** `ARTS_KEY` no `localStorage`.
     3. Zera `processedArtSignatures.current` (Set de hashes já processados).
     4. `setMessages([])`, `setInitial([])`, `setArtsCount(0)`, `setInput("")`, `setCooldownUntil(0)`.
     5. Incrementa `resetKey` (força reinício do `useChat`, dropando qualquer estado interno).
   - Adicionar um `window.confirm("Iniciar nova conversa? Isso vai apagar todas as imagens geradas e interromper qualquer geração em andamento.")` antes de executar, já que é destrutivo.

### Verificações pós-implementação

- Apertar "Parar" enquanto aparece "I.A GX está pensando..." → botão volta ao estado normal em <1s e nenhuma imagem é entregue depois.
- Apertar "Parar" durante a barra de "Gerando imagem com I.A GX" → idem; o card vira "Geração cancelada pelo usuário." e nenhuma imagem nova aparece nas próximas requisições.
- Tentar enviar nova mensagem enquanto há geração em andamento → bloqueado.
- "Nova conversa" durante geração ativa → confirma, interrompe, mensagens somem, contador "Memória (N)" some, próxima geração começa do zero sem usar artes antigas como referência.
- Modelo continua sendo `gemini-3.1-flash-image-preview` (Nano Banana 2 Flash — versão intermediária). Sem alteração de modelo.

### Fora de escopo

- Não vou adicionar fila no servidor nem rate-limit (sandbox sem primitivas adequadas; a trava de concorrência fica no cliente, que é onde o usuário interage).
- Não vou trocar o modelo de imagem.