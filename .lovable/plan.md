## Objetivo
Gerar artes em **1080×1920** usando **`gemini-3-pro-image-preview`** em vez do Nano Banana atual.

## Mudanças

### 1. `src/routes/api/chat.ts`
- `GOOGLE_IMAGE_MODEL`: `"gemini-2.5-flash-image"` → `"gemini-3-pro-image-preview"`.
- `GOOGLE_TIMEOUT_MS`: `90_000` → `150_000` (Pro é mais lento).
- Em `callGoogleImage`, o body passa a incluir:
  ```ts
  generationConfig: {
    responseModalities: ["IMAGE", "TEXT"],
    imageConfig: { aspectRatio: "9:16" },
  }
  ```
- No `promptText` da tool, trocar menção `1024x1536` por `1080x1920 (proporção 9:16)`.

### 2. `src/routes/index.tsx`
- Adicionar helper `resizeDataUrlToExact(dataUrl, 1080, 1920)`:
  - Carrega a imagem via `<img>` + `decode()`.
  - Cria canvas 1080×1920, desenha com `drawImage` cobrindo todo o canvas (cover, centralizado).
  - Exporta PNG via `canvas.toDataURL("image/png")`.
- No `useEffect` que processa novas artes (`messages` change):
  - Antes de `saveArt(...)`, redimensionar `imageDataUrl` para 1080×1920.
  - Atualizar a parte da mensagem (via `setMessages`) com o novo dataURL para que o `<img>` e o link de Download usem a versão final 1080×1920.
- Atualizar texto do loader: "Gerando arte com Nano Banana 2..." → "Gerando arte com Gemini 3 Pro Image (1080×1920)...".

### Out of scope
Sem alteração em banco, auth, ou na lógica de variação de paleta/fundo.

### Risco
Se a chave gratuita do Google AI Studio do usuário não tiver acesso ao preview, o card de erro categorizado (`model_not_found` / `permission`) já mostrará isso claramente — sem regressão silenciosa.
