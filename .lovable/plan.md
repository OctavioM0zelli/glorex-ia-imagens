## Arquitetura aprovada

```
Frontend → /api/generate-image (rota TanStack server-side)
         → Gemini / Nano Banana 2
         → Supabase Storage (bucket glorex-generated-images)
         → retorna { success, imageUrl }
```

Não usaremos Supabase Edge Function: na TanStack Start, uma rota server-side resolve o mesmo problema (segredos no servidor, sem CORS, sem deploy paralelo). A chave `GOOGLE_AI_API_KEY` continua somente no servidor, lida via `process.env`.

## O que vou criar / mudar

### Bucket de Storage ✅ (já executado nas migrations)
- `glorex-generated-images`, público, limite 20 MB, MIME types: `image/png`, `image/jpeg`, `image/webp`.
- Sem policy de listagem (URLs públicas continuam funcionando, mas a listagem do bucket fica fechada).

### `src/lib/image-generation.server.ts` (novo)
Helper server-only que:
- chama o Google `${GOOGLE_IMAGE_MODEL}` (default `gemini-3.1-flash-image-preview`, configurável por env) com retry + fallback para `gemini-2.5-flash-image` e, em última instância, Lovable AI Gateway;
- decodifica o base64 e faz upload em `glorex-generated-images` com nome único `${Date.now()}-${randomUUID}.${ext}`;
- devolve `{ ok:true, imageUrl }` ou `{ ok:false, category, error, requestId }` com categorias claras (`quota`, `auth`, `bad_request`, `upstream`, `safety`, `timeout`, `network`, `storage`, `aborted`, …);
- logs estruturados em cada etapa; respeita `parentSignal` para cancelamento.

### `src/routes/api/generate-image.ts` (novo)
Rota server-side com o contrato pedido:
- `POST { prompt, references?: string[], includeBrandReferences?: boolean }` validado por Zod;
- carrega referências da marca (logo + 6 templates) automaticamente;
- chama o helper, devolve:
  - sucesso: `{ success: true, imageUrl, path, requestId }`
  - erro: `{ success: false, error, category, requestId }` com status HTTP coerente (`429`, `401`, `400`, `502`, `500`).

### `src/routes/api/chat.ts` (refatoração)
- A tool `gerar_arte_glorex` continua existindo (mantém o fluxo conversacional), mas agora usa o helper compartilhado: chama `generateAndStoreImage`, recebe `imageUrl` e devolve no shape `{ ok, imageUrl }` em vez de `imageDataUrl`.
- Remove o código duplicado de `callGoogleImage` / `callLovableGatewayImage` (movido para o helper).
- Resultado: a resposta SSE do chat passa a carregar só uma URL curta — fim do payload base64 gigante que estava causando os erros de network/timeout.

### `src/routes/index.tsx` (ajustes mínimos)
- `ArtePart.output` passa a usar `imageUrl` em vez de `imageDataUrl`.
- Render do `<img>` aponta direto para a URL pública.
- Memória de estilo (`ARTS_KEY`) passa a guardar `{ id, imageUrl, createdAt }`; envio de referência para o servidor manda a lista de URLs.
- Remove a lógica client-side de compressão/resize (não precisa mais — o Storage devolve a imagem original; o Google já recebe `aspectRatio: 9:16`).
- Mantém: lock de "uma geração por vez" (`isBusy`), botão Parar com abort, botão Nova conversa com confirmação, cooldown de 429, mensagens de erro categorizadas.

### Variáveis necessárias (todas já configuradas ✅)
- `GOOGLE_AI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`.
- Opcional novo: `GOOGLE_IMAGE_MODEL` (e `GOOGLE_IMAGE_FALLBACK_MODEL`) — só precisa configurar se quiser trocar o modelo sem mexer no código.

## Verificação pós-implementação

- `POST /api/generate-image` com `{ prompt: "..." }` retorna `{ success:true, imageUrl: ".../glorex-generated-images/..." }` e a URL abre a imagem.
- No chat, gerar uma arte → o card aparece com `<img>` carregado da URL pública (Network mostra GET na Supabase Storage, sem base64 no payload do chat).
- Erros (429/500/safety) → card de erro amigável com categoria correta.
- Botão Parar interrompe a geração; Nova conversa limpa tudo; segundo envio é bloqueado enquanto o primeiro roda.

## Fora de escopo

- Não criar Supabase Edge Function (substituída pela rota TanStack equivalente).
- Não adicionar fila/rate-limit no servidor.
- Não mudar o prompt artístico nem os templates de referência.
