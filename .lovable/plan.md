## Plano

Trocar o modelo de geração de imagem para **`google/gemini-3.1-flash-image-preview`** (Nano Banana 2) — meio-termo entre qualidade e custo.

### Mudança
- `src/routes/api/chat.ts`: substituir `google/gemini-2.5-flash-image` por `google/gemini-3.1-flash-image-preview` na tool de geração de imagem.

### Validação
- Gerar uma arte de teste no preview e comparar com a qualidade anterior.
- Se ainda ficar abaixo do aceitável, próximo passo é voltar pro `gemini-3-pro-image-preview` ou partir pro `gpt-image-1` da OpenAI com chave própria.

Sem alterações em UI, prompts ou regras de estilo.
