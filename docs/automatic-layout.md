# Layout automático de autômatos

O desenho padrão em **Show automaton**, as exportações SVG/PNG e a criação de
layouts visuais usam o motor híbrido para autômatos com até 100 estados.
Acima desse limite, a visualização e a exportação de imagens continuam usando
Graphviz após a confirmação de renderização; o limite do editor permanece em
100 estados.

## Uso

Abra **Visual layout**, escolha **Layout strategy** e clique em **Auto layout**:

- **Automatic — compare candidates:** compara alternativas direcionais,
  equilibradas, circulares e, quando aplicável, uma reflexão estrutural.
- **Layered — left to right:** privilegia a leitura em camadas.
- **Balanced — stress minimization:** privilegia distâncias e equilíbrio espacial.
- **Circular:** organiza os estados ao redor de um círculo, seguindo a vizinhança
  para evitar uma ordenação arbitrária em ciclos simples.

Os novos layouts já abrem enquadrados no conteúdo. **Undo layout** restaura a disposição anterior ao último recálculo. **Cancel
layout** interrompe a busca e mantém o desenho anterior. **Fit diagram** restaura
o enquadramento. **Save Layout** persiste o resultado; fechar o editor sem salvar
preserva o layout salvo anteriormente. A criação de um novo autômato visual
também guarda as posições e as curvas da prévia.

Layouts já salvos continuam disponíveis. Use **Auto layout** para aplicar o novo
algoritmo a eles. Ao arrastar estados, as curvas acompanham seus extremos.
Também é possível arrastar traços, pontos sobre as curvas e rótulos, com grade
opcional. Veja [os controles de edição manual](drawing-editor.md).

## Como os candidatos são gerados

1. O motor separa componentes fracamente conexos e agrupa os eventos com a mesma
   origem e destino somente para apresentação. Calcula dimensões dos círculos e
   dos rótulos antes do posicionamento.
2. O candidato em camadas é inspirado na família Sugiyama: níveis de alcance
   dirigido, acomodação de vértices alcançáveis apenas no sentido inverso,
   vértices auxiliares para arestas longas, varreduras por baricentro/mediana e
   trocas adjacentes. A melhor ordenação encontrada é mantida. As arestas de
   retorno e os ciclos permanecem no modelo e recebem roteamento próprio.
3. O candidato equilibrado implementa **stress majorization** sobre distâncias
   de caminhos mínimos no esqueleto não direcionado, com pesos inversamente
   proporcionais ao quadrado dessas distâncias. Resolve sucessivos sistemas com
   a Laplaciana ponderada ancorada e fatoração de Cholesky reutilizada. Há até
   75 iterações e duas inicializações determinísticas, conforme o tamanho.
4. O candidato circular usa uma ordem derivada das adjacências. Em ciclos simples,
   isso expõe a estrutura cíclica sem exigir um fluxo artificial em camadas.
5. Quando estados têm a mesma vizinhança aberta no esqueleto, uma alternativa
   coloca esses grupos em pares refletidos sobre um eixo horizontal. Estados
   fora dos grupos ficam sobre o eixo. É uma família limitada de reflexões
   realizáveis, sem alegar descoberta de todos os automorfismos.

O esqueleto usado para equilíbrio e reflexão ignora direções, símbolos, laços e
marcações somente durante o cálculo das posições; o estado inicial é excluído
dos grupos de troca. Isso não representa uma simetria semântica do AFD completo.
Todas as direções, transições, marcações e classes de eventos originais são
conservadas no desenho e nos dados do autômato.

## Roteamento e avaliação

Cada candidato é roteado antes de ser avaliado. O motor compara curvas quadráticas
entre estados, curvas cúbicas para laços e retângulos de rótulos. Movimentos opostos
recebem curvas em lados diferentes; laços testam diferentes lados; rótulos podem
deslocar-se ao longo ou para fora da curva. Uma segunda passagem melhora as rotas
de grafos pequenos. O melhor candidato pode passar por expansão uniforme e novo
roteamento sem desfazer sua reflexão ou rotação.

A comparação é lexicográfica: sobreposição de estados, colisões de rótulos com
estados, curvas atravessando estados intermediários, sobreposição de rótulos,
cruzamentos entre curvas e colisões entre curvas e outros rótulos. Os desempates
consideram a reflexão estrutural identificada, o comprimento e a área. Uma
economia de área não compensa uma colisão mais grave.

O avaliador e o renderizador compartilham o mesmo contrato de geometria:
raios dos estados, recorte dos pontos de conexão, pontos de controle, caixas e
deslocamentos de rótulos. Os textos usam fonte monoespaçada, dimensões
conservadoras e quebra em linhas de até 26 caracteres. Vários eventos são
acomodados em fileiras de chips, preservando todos os nomes e as cores de
controlabilidade. O canvas reserva espaço para rótulos, laços e seta inicial.

É uma heurística de legibilidade, sem garantia de planaridade, ótimo global ou
simetria completa. As curvas são avaliadas por aproximações com 12 segmentos;
diagramas densos usam amostragem determinística de até 30 mil pares de arestas.
Há também limites para vértices auxiliares e alternativas de roteamento. As
etapas cedem execução e verificam cancelamento durante a busca.

## Compatibilidade e verificação

Layouts antigos recebem raio padrão 30 e deslocamentos de rótulo iguais a zero.
SVG e TikZ preservam as curvas calculadas; a exportação DOT continua fornecendo
a fonte Graphviz nativa. O formato e o comportamento lógico do autômato não são
modificados pelo recálculo.

Os testes .NET verificam determinismo, cancelamento, limite de tamanho, conservação
do modelo, ciclos, reflexão, laços, sentidos opostos, componentes desconexos,
rótulos longos e limites do canvas. Os testes Chromium medem colisões na geometria
do DOM, validam curvas contra estados intermediários, recálculo, desfazer,
persistência, criação visual e exportações em desktop e celular.

Comparação com o layout anterior da revisão
`363838b960595a34799095853c4f1c5c9d25e1c0`, usando a mesma métrica geométrica para
ambos os resultados:

A comparação avalia as posições e os pontos de controle dos dois algoritmos
com o contrato geométrico do renderizador atual; não compara bitmaps antigos.

| Caso | Cruzamentos antes → depois | Curvas atravessando estados antes → depois | Colisões entre rótulos antes → depois |
| --- | --- | --- | --- |
| Anel com 8 estados | 0 → 0 | 6 → 0 | 0 → 0 |
| Diamante | 0 → 0 | 0 → 0 | 0 → 0 |
| Ida/volta com laços | 0 → 0 | 2 → 0 | 0 → 0 |
| Ciclo de 12 estados com cordas | 20 → 6 | 4 → 0 | 3 → 0 |
| Componentes desconexos | 0 → 0 | 1 → 0 | 0 → 0 |

O caso com rótulos longos também passou de duas colisões entre rótulos e estados
para zero. A cadeia de 100 estados manteve zero colisões e cruzamentos.
Esses resultados descrevem as instâncias de teste, sem afirmar superioridade
universal. As medidas completas estão em [layout-benchmark.json](layout-benchmark.json).
