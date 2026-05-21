# Tornar a programação do Glorex flexível (horário sem valor é válido)

## Problema atual
O schema `GlorexBriefingSchema.rodadas[]` exige `premio` obrigatório. Resultado: a IA do chat trata todo horário como rodada de bingo e força um valor em R$ — mesmo quando o funcionário manda "20:30 o 2° sorteio" ou "21:30 caixa de picanha". O builder do prompt também renderiza as linhas como "horário — prêmio", reforçando o erro.

## Objetivo
Aceitar qualquer conteúdo após o horário (sorteio, item físico, balão premiado, rodada de bingo, série, descrição livre) e renderizar fielmente na arte, com destaque visual adequado ao tipo.

## Mudanças

### 1. `src/lib/glorex-briefing.ts` — novo schema
Substituir `GlorexRodadaSchema` / `rodadas` por `GlorexEventoSchema` / `programacao`:

```ts
GlorexEventoSchema = z.object({
  horario: z.string().min(1),
  tipo: z.enum(["rodada_bingo", "sorteio", "premiacao_item", "evento"]).default("evento"),
  conteudo: z.string().min(1),          // descrição livre, sempre presente
  valor: z.string().optional(),          // só quando há dinheiro envolvido (R$ XXX)
  observacao: z.string().optional(),     // série, condição, detalhe
});

GlorexBriefingSchema = {
  dia_da_semana_evento, oferta_topo?, horario_abertura,
  programacao: z.array(GlorexEventoSchema).min(1).max(12),
  dia_numero, regra_especial?, premio_extra?, condicao_extra?,
  observacao_progressiva?,
  chamada_final (default),
}
```

Quebra de compatibilidade aceita (não há persistência de tool-calls).

### 2. `buildGlorexImagePrompt` — render adaptativo do bloco 3
Cada linha mostra apenas o conteúdo real, **sem rótulos de coluna** ("observação", "conteúdo", "tipo" não aparecem na arte). Formato:

```text
   {horario}  ⏰  {valor?}  {conteudo}  {observacao?}
```

Regras visuais por `tipo` (descritas em texto natural no prompt do Gemini):
- `rodada_bingo`: `valor` em dourado 3D grande; `conteudo` e `observacao` em branco como complemento.
- `sorteio`: palavra "SORTEIO" em destaque na própria linha; `conteudo` em branco grande; `valor` em dourado se houver.
- `premiacao_item`: ícone/ilustração do item; `conteudo` em branco grande; sem exigir valor.
- `evento`: linha sóbria em branco, sem dourado.

Atualizar "REGRAS CRÍTICAS" do prompt: horários sem valor em dinheiro são válidos e devem aparecer fielmente, sem inventar prêmios. Renomear "BLOCO DE HORÁRIOS" → "BLOCO DE PROGRAMAÇÃO".

### 3. `normalizeGlorexBriefing` em `image-generation.server.ts`
- Trocar `b.rodadas.map(...)` por `b.programacao.map(...)`.
- Normalizar `horario`, `conteudo`, `valor?`, `observacao?`.
- Não preencher `valor` se vier vazio.
- Normalizar novo campo `observacao_progressiva`.

### 4. `src/routes/api/chat.ts` — system prompt + tool
Atualizar `SYSTEM_PROMPT`:
- Trocar bloco "MAPEAMENTO DOS CAMPOS" para o novo schema.
- **Regra de ouro**: "Após encontrar um horário, capture TODO o texto até o próximo horário como `conteudo` daquele evento."
- Regras de classificação do `tipo`:
  - tem R$ + parece bingo → `rodada_bingo` (separar valor em `valor`)
  - contém "sorteio" → `sorteio`
  - item físico (picanha, cesta, brinde, balão, airfryer, frigobar, kit churrasco) → `premiacao_item`
  - resto → `evento`
- Proibições explícitas: nunca exigir valor, nunca inventar prêmio, nunca descartar horário sem dinheiro, nunca transformar sorteio em rodada com valor.
- Campos obrigatórios reduzidos: `dia_da_semana_evento`, `horario_abertura`, `programacao` (≥1), `dia_numero`.
- 3-4 exemplos inline (dos enviados pelo usuário).

Ajustar `resumo` retornado pela tool: `eventos: briefing.programacao.length`.

### 5. `src/routes/api/generate-image.ts`
Sem mudança estrutural — herda automaticamente o novo schema via `z.union`.

### 6. Memória do projeto
Atualizar `mem://design/estrutura-fixa.md`:
- Bloco 3 agora é "Programação" (não "Horários/Rodadas").
- Horário pode ter apenas descrição, sem valor.
- Tipos válidos: rodada_bingo, sorteio, premiacao_item, evento.
- Rótulos de coluna (observação/conteúdo/tipo) NUNCA aparecem renderizados na arte.

## Fora de escopo
- Frontend / UI.
- Storage, RLS, auth, bucket de referências.
- Modelo de imagem, paletas.

## Arquivos
- editar `src/lib/glorex-briefing.ts`
- editar `src/lib/image-generation.server.ts`
- editar `src/routes/api/chat.ts`
- editar `mem://design/estrutura-fixa.md`
