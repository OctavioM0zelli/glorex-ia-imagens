# Plano de melhorias — Glorex IA

Objetivo: app mais leve (mobile antigo), menos erros, melhor diagnóstico, e IA que evolui a cada arte gerada — sem alterar a identidade visual definida pelo usuário.

---

## 1. Performance e leveza (mobile antigo)

**Imagens**
- Servir referências como WebP além de JPEG (fallback `<picture>`), com `loading="lazy"` e `decoding="async"` em todos os `<img>` do chat.
- Comprimir as artes geradas no cliente antes de salvar no `localStorage` (canvas → JPEG 0.8, max 720px). Hoje guardamos data URL bruta do modelo (pode passar de 1MB cada).
- Migrar histórico de artes de `localStorage` para **IndexedDB** (via `idb-keyval`, ~600 bytes). `localStorage` em Android antigo trava UI e tem limite ~5MB — facilmente estourado com 3 PNGs base64.
- Mostrar thumbnail (256px) na lista; só carregar full-size ao clicar / baixar.

**Bundle**
- `React.lazy` no painel de geração / preview de imagem; manter rota `/` com shell mínimo.
- Remover ícones não usados de `lucide-react` (importar individuais já está OK, conferir).
- Verificar se há dependências pesadas não utilizadas (`bun pm ls` + análise).

**Rede**
- `Cache-Control: public, max-age=31536000, immutable` nos arquivos `public/glorex/ref-*.jpg`.
- Pré-conectar ao gateway (`<link rel="preconnect" href="https://ai.gateway.lovable.dev">`).

---

## 2. Robustez / menos erros futuros

**Servidor (`/api/chat`)**
- Validar input com **Zod** (mensagens, `artesGeradas` array de strings com tamanho/qtd máximos) — hoje confiamos no cliente.
- Timeout explícito (`AbortController`, 60s) na chamada ao gateway, com mensagem clara ao usuário.
- Retry com backoff exponencial em `429` e `5xx` (máx 2 tentativas).
- Tratar `402` (créditos), `429` (limite) e `5xx` com mensagens específicas no UI (toast + texto na bolha).
- Limitar tamanho do payload final (somar bytes das imagens; se > ~4MB, reduzir nº de templates rotativos antes de chamar o modelo).

**Cliente**
- `ErrorBoundary` na rota `/` com botão "tentar novamente" e link "limpar memória".
- Try/catch ao ler `localStorage`/IndexedDB (corrupção, modo privado iOS).
- Detectar offline (`navigator.onLine`) e bloquear envio com mensagem amigável.
- Confirmação antes de "limpar memória" (já existe botão; evitar perda acidental).

**Tipos & build**
- Tipos compartilhados (`ArtePart`, `ArteOutput`, `GenerateArteInput`) em `src/lib/types.ts` para servidor e cliente não divergirem.
- Schema Zod único exportado e reusado nos dois lados.

---

## 3. Observabilidade / diagnóstico de erros futuros

- **Logs estruturados** no servidor (JSON: `{ ts, route, model, durationMs, payloadKb, status, errorCode }`) — facilita filtro em `stack_modern--server-function-logs`.
- ID de requisição (`crypto.randomUUID()`) ecoado no header `x-request-id` e mostrado discretamente no rodapé da bolha de erro — usuário copia e cola pra debug.
- Tabela Lovable Cloud opcional `art_generations` (id, created_at, prompt_resumo, status, error_code, duration_ms, payload_kb) — sem armazenar a imagem, só metadados, com RLS por usuário ou anônima por sessão.
- Captura de erros do cliente: `window.addEventListener('error'/'unhandledrejection')` enviando para um endpoint `/api/public/client-errors` (rate-limited).
- Métricas básicas: taxa de sucesso, p50/p95 de latência, erros por código — visíveis numa página `/admin` simples (protegida).

---

## 4. IA aprendendo a cada arte (sem inflar payload)

Hoje mandamos a última arte como referência. Para aprender de verdade sem pesar:

- **Resumo textual evolutivo**: depois de cada geração, o servidor extrai (com modelo barato `gemini-3-flash-lite`) um JSON curto: `{ paleta, layout, elementos, dia }`. Guardamos só esse JSON (centenas de bytes) no IndexedDB.
- No próximo prompt, enviamos os últimos **8 resumos** + **1 imagem miniatura** (256px) da arte mais recente. Custo de tokens muito menor, contexto muito maior.
- Regra explícita no system prompt: "NÃO repetir paleta/layout dos resumos anteriores" — gera variação real.
- Banco de "aprendizados" persistente em Lovable Cloud (opcional): tabela `art_memory` por usuário, com top 20 resumos. Permite o app "lembrar" mesmo trocando de dispositivo.
- Botão "gostei dessa" / "não gostei" → marca o resumo como referência positiva/negativa pesada nos próximos prompts.

---

## 5. Boas práticas gerais

- **Sem secrets no cliente**: confirmar que `LOVABLE_API_KEY` só aparece em arquivos `.server.ts` / rotas `api/`.
- Headers de segurança na rota: `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`.
- Rate limit simples por IP no `/api/chat` (ex.: 10 req/min) usando KV ou tabela — protege créditos.
- PWA leve: `manifest.json` + service worker só para cache das referências (offline-first das imagens estáticas, network-first do chat).
- Acessibilidade: `aria-live="polite"` na área de mensagens, alt em todas as imagens geradas (usar o `resumo.dia`).
- Testes mínimos: 1 teste e2e do fluxo "enviar prompt → receber imagem mock" e 1 teste do schema Zod.

---

## Ordem sugerida (impacto × esforço)

1. **Quick wins (baixo esforço, alto impacto)**
   - Zod no servidor, timeout + retry, mensagens de erro específicas, request-id, logs estruturados.
   - `loading="lazy"` + thumbnails + `Cache-Control` nas referências.
2. **Mobile leve**
   - Migrar histórico para IndexedDB + compressão das artes salvas.
3. **Aprendizado incremental**
   - Resumos JSON evolutivos no lugar de imagens completas como contexto.
4. **Observabilidade avançada**
   - Tabela `art_generations` + página `/admin` + captura de erros do cliente.
5. **Polimento**
   - PWA, rate limit, ErrorBoundary, testes.

---

## Perguntas antes de implementar

- Quer que eu já comece pelos **quick wins (1)** ou prefere escolher um bloco específico?
- Posso criar a tabela `art_generations` em Lovable Cloud (apenas metadados, sem imagens), ou prefere manter 100% client-side por enquanto?
- O botão "gostei / não gostei" entra no escopo agora ou depois?
