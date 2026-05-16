Vou implementar uma melhoria focada no diagnóstico da geração de arte:

1. **Padronizar erros da API de imagem**
   - Criar uma resposta estruturada para falhas com `code`, `status`, `message`, `requestId` e detalhe técnico resumido.
   - Tratar separadamente:
     - `401`: chave inválida/expirada.
     - `403`: chave sem permissão/API bloqueada/modelo indisponível para a chave.
     - `404`: modelo ou endpoint incorreto.
     - `429`: limite/cota atingida.
     - timeout/fetch failed: falha de rede ou tempo excedido.

2. **Melhorar o backend em `src/routes/api/chat.ts`**
   - Extrair o erro real retornado pelo Google (`error.message`, `error.status`, `error.code`) em vez de mostrar só “fetch failed”.
   - Registrar logs com status, código e corpo resumido, mantendo o `requestId` para rastrear a tentativa.
   - Fazer `toModelOutput` impedir que o assistente diga “gerei a arte” quando a tool falhou.

3. **Melhorar a mensagem visível no chat em `src/routes/index.tsx`**
   - Exibir uma caixa de erro mais clara com o status/código quando disponível.
   - Mostrar mensagens acionáveis, por exemplo “401 — chave inválida”, “429 — cota atingida”, “404 — modelo não encontrado”.
   - Manter o `id` da tentativa visível para depuração.

4. **Corrigir a hidratação do chat discretamente**
   - O erro atual indica que o servidor renderiza tela vazia e o cliente renderiza mensagens salvas do `localStorage` antes da hidratação terminar.
   - Ajustarei a inicialização para carregar histórico apenas após montar no cliente, evitando mismatch de SSR.

**Resultado esperado:** quando a arte falhar, você verá exatamente se foi chave, permissão, modelo, cota, timeout ou conexão, em vez da mensagem genérica “fetch failed”.