# Expandir base de referência da I.A GX

## O que muda

**1. Novos templates (6 imagens) como referência fixa**

Copiar para `public/glorex/` e `src/assets/`:
- `template-quarta.png` (azul/verde)
- `template-domingo.png` (amarelo)
- `template-terca.png` (laranja/azul)
- `template-quinta.png` (vermelho/preto)
- `template-sexta-v2.png` (vermelho/azul) — substitui ou complementa a antiga
- `template-terca-premiada.png` (dourado/preto)

Total: 8 templates + logo Novo Glorex sempre enviados como referência ao Nano Banana 2.

**2. Memória de gerações no navegador**

Cada arte que a I.A GX gerar é salva em `localStorage` (key `glorex-generated-arts`, base64 + resumo). Nas próximas gerações, essas artes são enviadas junto com os templates fixos como referências adicionais — a I.A "aprende" com o próprio histórico do usuário.

Limite: últimas 10 gerações (evitar payload gigante).

Botão "Limpar memória de artes" no header (ao lado de Nova conversa).

**3. Variação obrigatória em cada arte**

Atualizar o prompt do tool `gerar_arte_glorex` para instruir explicitamente:
- Variar paleta dentro do branco + laranja-amarelado (tons quentes, gradientes diferentes a cada arte)
- Variar disposição dos blocos de horário/valor (alinhamento, tamanho, cantos)
- Variar elementos decorativos (estrelas, moedas, brilhos, fitas, ícones)
- **Nunca** replicar exatamente um template — usar como referência de estrutura e energia, não copiar
- Logo Novo Glorex permanece intacto e sempre presente
- Layout vertical 1024x1536, fundo branco predominante, detalhes laranja-amarelados

**4. Nunca alterar o que o usuário envia**

Se o usuário anexar uma arte/imagem na conversa (futuro), ela vai como referência mas o prompt diz claramente para preservar identidade visual da imagem do usuário.

## Arquivos alterados

- `public/glorex/` + `src/assets/` — adicionar 6 PNGs
- `src/lib/glorex-references.server.ts` — listar os 8 templates + logo, aceitar `extraReferences: string[]` (data URLs vindas do client)
- `src/routes/api/chat.ts` — tool aceita `referenciasAdicionais` no inputSchema (data URLs das gerações anteriores), passa todas para o Nano Banana 2; prompt atualizado com regras de variação
- `src/routes/index.tsx` — salvar cada `imageDataUrl` gerado em `localStorage`, ler ao mandar mensagem e injetar via `body` do `useChat` no transport; botão "Limpar memória"

## Detalhes técnicos

```
localStorage:
  glorex-chat-messages          (já existe)
  glorex-generated-arts         (novo: [{ id, dataUrl, resumo, createdAt }])
```

Transport:
```ts
new DefaultChatTransport({
  api: "/api/chat",
  body: () => ({ artesGeradas: loadGeneratedArts().slice(-10).map(a => a.dataUrl) }),
})
```

No server, `artesGeradas` chega no body, é repassado ao tool via closure e concatenado às `images` enviadas ao endpoint do Nano Banana 2 (logo + 8 templates + até 10 gerações anteriores).

## Resultado

Toda nova arte gerada terá: logo Novo Glorex, fundo branco com laranja-amarelado, layout vertical, variação de cor/disposição/elementos a cada geração, e memória crescente que faz a I.A entender o estilo do usuário com o uso.