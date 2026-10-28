# Edição visual dos autômatos

Abra **Visual layout** em um autômato ou **New visual automaton** para criar um
desenho. Os dois modos compartilham os mesmos gestos de edição geométrica:

- **Mover estado:** arraste qualquer parte do círculo. O ponto em que você pegou
  o estado permanece sob o cursor; as setas de entrada, saída e os laços acompanham
  o movimento. Curvas mantêm seu afastamento relativo ao eixo entre os estados.
- **Arquear transição:** arraste o próprio traço ou selecione a transição e
  arraste seu ponto redondo. O ponto fica sobre a curva visível. É possível
  atravessar a reta entre os estados para inverter o lado do arco.
- **Ajustar laço:** arraste seu ponto para girar e aumentar ou diminuir o laço.
  Há encaixe nas direções horizontal e vertical.
- **Mover texto:** arraste o rótulo da transição independentemente da curva.
- **Ações da seleção:** use **Straighten**, **Mirror curve** e **Center label**.
  Em laços, as duas primeiras ações viram **Reset loop** e **Rotate loop**.
  O menu de contexto oferece as mesmas ações.
- **Enquadrar:** arraste o fundo para deslocar a vista, use a roda para zoom
  em torno do cursor ou clique em **Fit diagram**.

O movimento é contínuo. Guias indicam alinhamento com outros estados e
**Snap to grid** habilita encaixe em passos de 20 unidades. Segure **Alt** para
ignorar os encaixes. **Escape** durante um arrasto restaura a geometria e a vista
anteriores ao gesto; cancelamento de toque faz o mesmo. Um segundo Escape pode
fechar o modal quando não há seleção ou gesto ativo.

Na criação, **Transition** permite clicar na origem e no destino com uma prévia
da seta. Também é possível usar Shift-arrastar. Novas transições em sentidos
opostos recebem arcos separados. Digitar altera o nome do item selecionado;
dois cliques em um estado alternam sua marcação e em um evento alternam sua
controlabilidade. Em **Visual layout**, a estrutura do autômato é somente leitura.

**Save Layout** guarda posições, curvas, deslocamentos dos rótulos e vista.
Na criação, **Create Automaton** guarda o desenho com o novo modelo.

**Export SVG** centraliza o desenho em uma página do tamanho do conteúdo com
margem de 12 unidades, incluindo laços, setas e rótulos. O enquadramento não
depende do deslocamento ou zoom do canvas e não altera a vista do editor.

## Implementação e referência

O `fsm.js` fornecido, de Evan Wallace, inspirou as âncoras relativas, o
deslocamento do ponto de pega e o ajuste angular dos laços. A atribuição e a
licença MIT estão em [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
O editor mantém sua renderização SVG e os formatos existentes de persistência.

Durante o movimento de um estado, cada curva é expressa por uma fração do
segmento entre seus extremos e um afastamento perpendicular. Os deslocamentos
dos rótulos são convertidos no mesmo referencial. Laços mantêm seu vetor relativo
ao estado. A gravação continua usando coordenadas absolutas para compatibilidade.

O arrasto do traço resolve o ponto da curva efetivamente selecionado, incluindo
o recorte nos círculos. Pointer capture mantém o gesto ao sair do elemento;
requestAnimationFrame agrupa repinturas. Mouse e toque usam o mesmo fluxo.
As linhas auxiliares e os pontos de edição não entram nos SVGs exportados.

`npm run test:editor` verifica a matemática das âncoras, curvas, encaixes e estados
coincidentes. Os testes Playwright verificam arrastos reais, rótulos, ações de
curva, laços, cancelamento, persistência, criação e toque no Chromium. Screenshots
e traces de falhas seguem a configuração do projeto.
