## Objetivo

Sempre que a geração de arte falhar, mostrar ao usuário **a causa categorizada** (referências, quota, timeout, auth, permissão, modelo, safety, rede) junto com o **requestId completo**, sem depender de o Gemini repetir o erro corretamente em texto livre.

## Mudanças

### 1. `src/routes/api/chat.ts`

- Adicionar tipo `ArteErrorCategory = "references" | "quota" | "auth" | "permission" | "model_not_found" | "bad_request" | "upstream" | "safety" | "timeout" | "network" | "unknown"`.
- Em cada `return { ok: false, ... }` da tool `gerar_arte_glorex`, incluir o campo `category` correspondente:
  - falha de `getGlorexReferences` → `"references"`
  - HTTP 429 → `"quota"`
  - HTTP 401 → `"auth"`
  - HTTP 403 → `"permission"`
  - HTTP 404 → `"model_not_found"`
  - HTTP 400 → `"bad_request"`
  - HTTP 5xx → `"upstream"`
  - resposta sem imagem → `"safety"`
  - `AbortError` → `"timeout"`
  - demais exceções → `"network"`
- Atualizar `toModelOutput` para repassar a categoria ao Gemini, ex.:
  `"A FERRAMENTA FALHOU (categoria: ${category}). NÃO diga que a arte foi gerada. Repasse ao usuário: \"${error}\""`.

### 2. `src/routes/index.tsx`

- Estender o tipo `ArtePart.output` com `category?: string`.
- Criar `CATEGORY_META`:
  ```ts
  const CATEGORY_META: Record<string, { label: string; icon: LucideIcon }> = {
    references: { label: "Falha ao carregar referências da marca", icon: ImageOff },
    quota:      { label: "Cota do Google atingida",                icon: Gauge },
    auth:       { label: "Chave do Google inválida",               icon: KeyRound },
    permission: { label: "Sem permissão para o modelo",            icon: Lock },
    model_not_found: { label: "Modelo não encontrado",             icon: SearchX },
    bad_request:{ label: "Requisição rejeitada",                   icon: AlertTriangle },
    upstream:   { label: "Serviço do Google instável",             icon: ServerCrash },
    safety:     { label: "Bloqueio de segurança",                  icon: ShieldAlert },
    timeout:    { label: "Tempo esgotado",                         icon: TimerOff },
    network:    { label: "Falha de rede",                          icon: WifiOff },
    unknown:    { label: "Erro desconhecido",                      icon: AlertTriangle },
  };
  ```
- Reescrever o card de erro (último bloco de `ArteToolPart` + o estado `output-error`) para:
  1. Ícone + label da categoria em destaque
  2. Mensagem detalhada (`out.error`)
  3. Linha técnica monospace com `HTTP X · status · code · id <requestId completo>`
- Mostrar `requestId` inteiro (remover `.slice(0, 8)`).

### Out of scope
Sem mudanças em banco, dependências, ou lógica de geração. Apenas categorização + apresentação.
