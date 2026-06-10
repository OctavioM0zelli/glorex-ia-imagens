## Plano: Upgrade para Nano Banana Pro

### Objetivo
Trocar o modelo de geração de imagem do Glorex para a versão mais avançada do Nano Banana (`gemini-3.1-pro-image-preview`).

### Alterações

1. **Atualizar `src/lib/image-generation.server.ts`**
   - Trocar o default de `IMAGE_MODEL` de `gemini-3.1-flash-image-preview` → `gemini-3.1-pro-image-preview`
   - Manter o fallback como `gemini-3.1-flash-image-preview` (a versão flash vira fallback, já que é mais rápida/menor custo)
   - Atualizar comentários internos que mencionam "Nano Banana 2 Flash"

2. **Verificar compatibilidade**
   - O endpoint `generateContent` da Google AI API suporta o modelo pro-image-preview com os mesmos parâmetros (`responseModalities`, `imageConfig`, `aspectRatio: "9:16"`)
   - Nenhuma mudança no schema de requisição/resposta necessária

### Modelos após a mudança
- **Primário:** `gemini-3.1-pro-image-preview` (maior qualidade, pro-level)
- **Fallback:** `gemini-3.1-flash-image-preview` (mais rápido, caso o pro falhe)

### Arquivos modificados
- `src/lib/image-generation.server.ts` (linhas 10-12)