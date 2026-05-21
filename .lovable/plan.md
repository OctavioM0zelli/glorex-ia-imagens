# Pipeline de 3 etapas para geração de artes Glorex

## Objetivo

Implementar o fluxo estruturado descrito pelo usuário:

```
Texto cru do funcionário
  → Etapa 1: IA organizadora extrai JSON estruturado
  → Etapa 2: Sistema monta prompt final (determinístico)
  → Etapa 3: Nano Banana recebe prompt + referências e gera a imagem
```

Hoje o sistema já faz Etapa 3 e parcialmente a 2, mas o briefing chega como argumentos soltos da tool, sem a etapa explícita de "parser estruturado". O resultado é que campos importantes (oferta do topo, premio_extra separado da regra, condição extra, chamada final dupla) somem ou viram texto livre.

## Mudanças propostas

### 1. Novo schema estruturado (Etapa 1)

Em `src/lib/glorex-briefing.ts` (novo, client-safe) definir o Zod schema oficial do briefing — base única usada pela tool do chat E pela rota `/api/generate-image`:

```ts
GlorexBriefingSchema = z.object({
  dia_da_semana_evento: z.string(),         // "Quarta"
  oferta_topo: z.string().optional(),        // "50% em todo o cardápio..."
  horario_abertura: z.string(),              // "18:30"
  rodadas: z.array(z.object({
    horario: z.string(),                     // "19:00"
    premio: z.string(),                      // "R$ 400"
    observacao: z.string().optional(),       // "Série 4"
  })).min(1),
  dia_numero: z.string(),                    // "20" (bola do dia)
  regra_especial: z.string().optional(),
  premio_extra: z.string().optional(),       // "R$ 2.300"
  condicao_extra: z.string().optional(),
  chamada_final: z.string().default("NÃO PERCAM!!! BOA SORTE!!!"),
})
```

### 2. Tool do chat passa a usar o schema estruturado

Em `src/routes/api/chat.ts`:
- Substituir o `inputSchema` atual da tool `gerar_arte_glorex` pelo `GlorexBriefingSchema`.
- Atualizar o `SYSTEM_PROMPT` para instruir a IA a:
  1. Conversar com o usuário e coletar dados.
  2. Auto-corrigir typos/moeda/horários.
  3. Chamar a tool **passando o JSON estruturado completo** (não mais campos colados como `descricao: "500 — 4 reais"`).
- Manter `normalizeBriefingInput` como rede de segurança server-side.

### 3. Builder determinístico do prompt final (Etapa 2)

Em `src/lib/image-generation.server.ts`, extrair uma função pura:

```ts
buildGlorexImagePrompt(briefing: GlorexBriefing, paleta: string): string
```

Que monta o prompt seguindo exatamente a estrutura do exemplo do usuário:
- Bloco superior: logo pequena + título do dia + **oferta_topo em box destacado** (hoje some).
- Bloco horários: começa com "ABERTURA hh:mm", depois rodadas em linhas com `horario — premio — observacao`.
- Bloco central: "DIA {dia_numero}" + bola gigante com o mesmo número.
- Bloco regra especial: `regra_especial` + `premio_extra` em 3D dourado + `condicao_extra` em destaque secundário.
- Bloco final: `chamada_final` (suporta múltiplas linhas tipo "NÃO PERCAM!!! / BOA SORTE!!!").

Tanto `/api/chat` quanto `/api/generate-image` chamam este builder — fonte única de verdade do layout.

### 4. Rota `/api/generate-image` ganha modo estruturado

Hoje aceita só `{ prompt: string }`. Estender o schema:

```ts
{ prompt: string }                           // modo livre (mantido)
| { briefing: GlorexBriefingSchema }         // modo estruturado (novo)
```

No modo estruturado: aplica `normalizeBriefingInput` no briefing → chama `buildGlorexImagePrompt` → gera. Permite testar/disparar a Etapa 3 sem passar pelo chat.

### 5. Normalizador estendido

`normalizeBriefingInput` em `image-generation.server.ts` passa a operar sobre o novo schema:
- Currency em `rodadas[].premio` e `premio_extra`.
- Horários em `horario_abertura` e `rodadas[].horario`.
- Trim/capitalização em `dia_da_semana_evento`, `oferta_topo`, `regra_especial`, `condicao_extra`, `chamada_final`.

## Fora de escopo

- Mudanças visuais no frontend / componente de chat.
- Mudanças em RLS, bucket, autenticação.
- Mudanças no fluxo de referências do bucket (continua usando últimas N do bucket inteiro).
- Mudança de modelo de imagem (continua `GOOGLE_IMAGE_MODEL`).

## Arquivos afetados

- **novo**: `src/lib/glorex-briefing.ts` (schema + tipo compartilhado)
- **edit**: `src/lib/image-generation.server.ts` (builder de prompt + normalizador novo)
- **edit**: `src/routes/api/chat.ts` (tool com schema estruturado + system prompt)
- **edit**: `src/routes/api/generate-image.ts` (aceita briefing estruturado)
- **edit**: `mem://design/estrutura-fixa.md` (refletir os 6 blocos com nomes dos campos do schema)

## Risco

Quebra de compatibilidade interna: mensagens antigas do chat que tenham chamado a tool com o schema antigo (`jogadas[].descricao`, `bolaDoDia`, `slogan`) não conseguirão re-executar a tool. Mitigação: aceitar ambos os formatos por 1 release via `z.union`, ou simplesmente assumir que ninguém replay antigas (mais simples — recomendo este).
