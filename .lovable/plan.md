## Plano

1. **Evitar 3 tentativas inúteis quando a cota estourar**
   - Ajustar o fluxo do chat para que erro `429 / Too Many Requests` da geração de imagem seja tratado como falha final e clara, sem o assistente continuar tentando chamar a ferramenta repetidamente.
   - Se necessário, reduzir o `stepCount` para evitar loops longos quando a tool falha.

2. **Mostrar mensagem melhor para o usuário**
   - Melhorar o texto exibido no card de erro de cota, explicando que a geração foi bloqueada pela cota/limite de requisições do Google e que tentar de novo imediatamente tende a falhar.
   - Manter o `requestId` visível para depuração.

3. **Adicionar bloqueio temporário no frontend após 429**
   - Quando uma geração retornar `quota`, salvar um pequeno cooldown local.
   - Durante o cooldown, desabilitar “Gerar novamente” e o envio de nova geração, com aviso tipo “limite atingido, aguarde antes de tentar de novo”.
   - Isso evita gastar novas tentativas enquanto o provedor ainda está recusando.

4. **Manter os botões existentes**
   - Preservar o botão de parar geração e o botão “Gerar novamente”.
   - Apenas ajustar o comportamento para não disparar novas tentativas quando o limite estiver ativo.

## Detalhes técnicos

- Arquivos prováveis:
  - `src/routes/api/chat.ts`: tratamento do 429 no retorno da ferramenta e prevenção de loop.
  - `src/routes/index.tsx`: detectar `category: "quota"`, guardar cooldown em `localStorage`, bloquear envio/regeneração temporariamente e exibir aviso.
- Não vou alterar o prompt visual da arte nesta correção.