# Geração de Texto Estruturado

Abra **Operations → Generate Structured Text** ou o atalho **Structured Text**.
Selecione ao menos uma planta e um supervisor, gere a prévia e baixe o `.st`.
Selecionar outro papel para um autômato remove sua seleção anterior.
Alterar as seleções ou o nome invalida a prévia anterior.

O arquivo contém um `FUNCTION_BLOCK` por planta, um por supervisor e um `PROGRAM`
coordenador. A separação segue a arquitetura do tutorial de controle supervisório:
plantas executam ações, supervisores observam eventos e calculam desabilitações.
Não é necessário construir o produto síncrono das plantas.

## Contrato dos modelos

- Eventos são identificados pelo nome exato; a controlabilidade precisa ser igual
  em todos os autômatos que compartilham esse nome.
- Todos os eventos dos supervisores devem pertencer às plantas selecionadas.
- No supervisor, a ausência de uma transição de evento **controlável do seu
  alfabeto** desabilita esse evento naquele estado. Eventos fora de seu alfabeto
  não são restringidos. Os bloqueios dos supervisores são combinados por `OR`.
- Preserve os self-loops habilitadores no modelo de entrada. O gerador omite sua
  atualização redundante de estado, mas os usa ao calcular as desabilitações.
  Um supervisor reduzido precisa manter seu alfabeto e a informação de
  habilitação nas transições; mapas de desabilitação externos não são inferidos.
- Supervisores nunca desabilitam eventos incontroláveis. Se um deles pertence
  ao alfabeto do supervisor, mas não possui transição em algum estado, a prévia
  informa essa condição: quando o evento ocorrer sem transição, o supervisor
  mantém o estado. Algumas dessas combinações podem ser inalcançáveis; confira
  a compatibilidade dos modelos em conjunto com as plantas.
- Estados iniciais recebem o índice `0`. Nomes originais, índices e eventos
  compartilhados são documentados nos comentários. Identificadores usam prefixos
  numéricos para evitar colisões de caixa, acentos e pontuação.

## Ciclo do coordenador

1. A primeira chamada e cada ciclo com `reset = TRUE` reinicializam os autômatos
   e as filas sem disparar eventos. Isso prepara as prontidões e os bloqueios
   antes da primeira arbitragem.
2. `R_TRIG` captura as bordas dos `input_`. Contadores `UDINT` independentes
   preservam ocorrências simultâneas de eventos incontroláveis até sua execução.
   Bordas amostradas durante reset são descartadas. Pulsos físicos menores que
   um scan exigem captura de hardware ou outra adaptação na interface de entrada.
3. O coordenador consulta os bloqueios atuais dos supervisores e escolhe no
   máximo um evento. Incontroláveis têm prioridade; dentro de cada classe,
   a ordem é fixa pelo nome do evento. Não há garantia de equidade nem fila
   cronológica global entre sensores diferentes.
4. Eventos compartilhados exigem prontidão de **todas** as plantas participantes.
   Todos os blocos recebem o mesmo evento, uma única vez por scan.
5. As plantas atualizam seus estados e ações; os supervisores atualizam seu
   estado interno e seus bloqueios para a próxima arbitragem.
6. A ação global de cada evento controlável executado roda uma vez, mesmo quando
   compartilhado por várias plantas.

Contadores saturam em `UDINT#4294967295`, sem rollover. `queue_overflow` retém
o diagnóstico até reset. Os contadores e a arbitragem não substituem a
temporização e o mapeamento elétrico da aplicação.

## Pontos de personalização

- `input_E...`: mapeamento dos sensores de eventos incontroláveis.
- `req_E...`: demanda/condição operacional de evento controlável. O padrão
  `TRUE` permite execução automática quando as plantas e os supervisores permitem.
- `TODO onState`: ação contínua de cada estado de planta.
- `TODO onEntry` / `TODO onExit`: ações na entrada/saída de estados de planta.
- `TODO plant transition action`: ação local de uma transição controlável.
- `TODO onControllableEvent`: ação global do evento controlável, uma vez por scan.
- `act_state_N`: nível do estado ativo; `entry_state_N` e `exit_state_N`: pulsos
  de entrada/saída. Self-loops executam ações do evento, sem entrada/saída de estado.
- `act_E...`: pulso lógico do evento controlável no scan em que ele executa.

As ações do estado inicial também executam durante reset; entradas não são
repetidas enquanto o estado permanecer o mesmo. Complete os pontos apropriados
para a aplicação, sem duplicar uma ação entre seu ponto local e seu ponto global.
Os supervisores não contêm placeholders de ações ou saídas para atuadores.

O resultado é um template IEC 61131-3. Importe cada POU separadamente quando o
IDE exigir e adapte o dialeto, o agendamento da tarefa, as variáveis de I/O e os
tipos necessários ao CLP. Os placeholders não atribuem saídas físicas.

## Verificação

```bash
dotnet test UltraDESWeb.Tests/UltraDESWeb.Tests.csproj
npm run test:e2e
```

Os testes cobrem a geração, papéis exclusivos, prévia, download e a separação
entre ações das plantas e desabilitações dos supervisores.

O ST também foi compilado com Matiec (revisão
`3a41303bcb4e50403417bc39c63f88981d7d961e`) para quatro cenários: Small Factory,
eventos compartilhados, self-loops e alfabetos vazios. A execução do C gerado
verificou inicialização, reset, ações de estado, bloqueio modular, sincronização,
prioridade e filas de incontroláveis, ausência de veto incontrolável e saturação
dos contadores.
