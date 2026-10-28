# Exportação de autômatos

Selecione um autômato e clique em **Export**, ou use **Operations → Export
automaton**. No celular, o botão **Export** também aparece em cada cartão da
lista **All automata**. O modal permite trocar o autômato e o formato.

| Formato | Conteúdo |
| --- | --- |
| JSON | Modelo UltraDES com nomes, estados, transições, marcação e controlabilidade. |
| XML | Modelo XML UltraDES com nomes, estados, transições, marcação e controlabilidade. |
| ADS | Modelo com estados e eventos renumerados; eventos controláveis ímpares e incontroláveis pares. |
| FSM | Estados, transições, marcação e controlabilidade dos eventos. |
| FM | Estado inicial, estados finais e transições; não guarda controlabilidade. |
| WMOD | Módulo Supremica/Waters; escolha o papel de planta ou especificação. |
| DOT | Código Graphviz para desenhar o autômato. |
| SVG | Desenho vetorial. |
| PNG | Desenho rasterizado. |
| ST | Abre a seleção de plantas e supervisores para gerar Texto Estruturado. |

**Download file** inicia o download e mantém o modal aberto para baixar outros
formatos. No formato ST, **Configure plants and supervisors** abre o gerador,
com o autômato atual pré-selecionado como planta; seu papel pode ser alterado.
Veja [a documentação de Texto Estruturado](structured-text.md).

Para exportar vários modelos juntos em WMOD, use **Export multiple automata as
WMOD**. O painel permite selecionar plantas e especificações do módulo.

As conversões usam cópias dos modelos e preservam o workspace. O ADS substitui
os nomes dos estados e eventos por índices, conforme o formato nativo da
biblioteca. JSON, XML e FSM mantêm nomes e controlabilidade. SVG, PNG e DOT
representam o desenho, e não são arquivos de importação de modelos.

SVG e PNG pedem confirmação antes de renderizar mais de 100 estados. DOT pode
ser exportado diretamente sem renderizar o desenho. Erros de conversão aparecem
no próprio modal, que permanece disponível para escolher outro formato.

Até 100 estados, SVG e PNG usam o [motor híbrido de layout](automatic-layout.md),
também usado em **Show automaton**. Acima disso, usam Graphviz. Para exportar o
layout ajustado manualmente, abra **Visual layout** e use **Export SVG** ou
**Export TikZ**.

O SVG é centralizado em uma página com origem `(0, 0)`, ajustada aos limites do
desenho com margem de 12 unidades. O cálculo inclui os extremos das curvas,
laços, pontas das setas, espessuras dos traços e rótulos deslocados. Pan e zoom
do editor não alteram o enquadramento da exportação, mesmo quando os estados
estão fora das coordenadas originais do canvas. Exportar preserva a vista e as
posições salvas. O mesmo SVG ajustado é usado na conversão para PNG do motor
híbrido.
