## Objetivo

Usar a sua chave gratuita do Google (Gemini) tanto para **gerar imagens** quanto para o **chat de texto**, eliminando completamente o consumo do crédito de $1 do Lovable AI Gateway.

## O que muda

Hoje:
- Chat de texto → Lovable AI Gateway (consome $1/mês grátis)
- Geração de imagem → Lovable AI Gateway (também consome $1/mês grátis) — causa do erro 402

Depois:
- Chat de texto → API direta do Google (sua chave gratuita)
- Geração de imagem → API direta do Google (sua chave gratuita)
- Lovable AI Gateway → não é mais usado

Resultado: erro **402 Payment Required some por completo** para uso normal, dentro da cota grátis diária do Google.

## Etapas

1. **Você revoga a chave antiga** (a que foi colada no chat público) em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) e cria uma nova.
2. **Eu abro o cofre seguro do Lovable** e peço para você colar a nova chave em `GOOGLE_AI_API_KEY` (uma única vez, fica salva e criptografada — nunca mais aparece no chat).
3. **Edito `src/routes/api/chat.ts`** para:
   - Trocar a chamada de texto: em vez de Lovable AI Gateway, chamar `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` com a sua chave.
   - Manter a chamada de imagem (Nano Banana) também na sua chave.
   - Manter exatamente o mesmo system prompt do GloreX (fundo branco + tons de laranja, variação de cores, etc.) → **nenhuma mudança visual no chat ou nas artes**.
4. **Adapto o parser** das respostas: a API do Google retorna um formato ligeiramente diferente do Lovable AI Gateway (campos `candidates[].content.parts[].text`), então o streaming/exibição é ajustado para ler corretamente.
5. **Testo no preview**: enviar uma mensagem de texto, pedir uma arte, e confirmar que ambas funcionam sem 402.

## Cotas grátis do Google (referência)

- **Gemini 2.5 Flash (texto)**: cerca de 1.500 requisições/dia grátis — mais do que suficiente para o chat.
- **Gemini 2.5 Flash Image (Nano Banana)**: cota diária menor mas razoável para divulgação de bingo. Se um dia passar do limite, o Google retorna erro e basta esperar o reset (00h Pacífico).

## Riscos / pontos de atenção

- **Streaming**: a API direta do Google tem endpoint `:streamGenerateContent` separado. Vou usar a versão não-streaming (`:generateContent`) para simplificar — a resposta aparece de uma vez em vez de palavra-por-palavra. Se quiser streaming visual depois, dá pra adicionar.
- **Se a chave do Google atingir limite diário**, o chat e as imagens param até o reset. (Mesmo comportamento de hoje com o crédito de $1, mas com cota muito maior.)
- O Lovable AI Gateway continua disponível como fallback futuro — não removo o código, só deixo de chamá-lo.

## Você confirma?

Se sim:
1. Revogue a chave antiga e crie uma nova agora.
2. Responda **"pode seguir"** que eu abro o campo seguro para você colar a chave nova e já implemento tudo na sequência.