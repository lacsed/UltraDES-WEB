# UltraDES WEB APP

## Editor visual

Arraste estados para mover suas setas junto, arraste o traço ou o ponto sobre a
curva para arquear transições e mova rótulos separadamente. Há ajuste de laços,
guias de alinhamento, grade opcional e ações para endireitar ou espelhar curvas.
Veja [os gestos e controles do editor](docs/drawing-editor.md).

## Layout automático

O desenho e as exportações SVG/PNG comparam layouts em camadas, por stress e
circulares, com reflexão estrutural quando aplicável. No editor, use
**Visual layout → Auto layout** para recalcular, trocar a estratégia ou desfazer.
Veja [o algoritmo, os limites e a validação](docs/automatic-layout.md).

## Exportação

Selecione um autômato → **Export** para escolher JSON, XML, ADS, FSM, FM, WMOD,
DOT, SVG, PNG ou acessar a geração de Texto Estruturado. O mesmo modal está em
**Operations → Export automaton**. Veja [os formatos e suas opções](docs/export.md).

## Geração de código para CLP

Use **Operations → Generate Structured Text** para selecionar plantas e
supervisores e baixar um template `.st` com ações de estados e de eventos
controláveis. Os supervisores apenas desabilitam eventos controláveis.
Veja [o funcionamento e os pontos de personalização](docs/structured-text.md).

## Testes de navegador

Requisitos: Node.js 20 ou superior e .NET SDK 8.

```bash
npm ci
npm run browsers:install
npm run test:editor
npm run test:e2e
```

Playwright está fixado em **1.64.1**. O Chromium correspondente é instalado
localmente em `node_modules/playwright-core/.local-browsers`.
Em Linux, instale também as bibliotecas do sistema, se necessário:
`npm run browsers:install -- --with-deps` (pode exigir privilégios de administrador).

Os testes iniciam o Blazor automaticamente em `http://127.0.0.1:5173`.
Para testar um servidor existente, defina `PLAYWRIGHT_BASE_URL` com a URL desejada.
No ambiente gerenciado, o script também reconhece o SDK .NET instalado em
`../.dotnet` e o cache NuGet em `../.cloud-setup/nuget`.

Em falhas, screenshots e traces ficam em `test-results/`; o relatório HTML fica
em `playwright-report/`. O trace é capturado desde a primeira tentativa e
preservado quando ela falha.

```bash
npm run test:e2e:report
npm run test:e2e:trace -- test-results/<teste>/trace.zip
npm run test:e2e:ui
```

O workflow `Playwright E2E` executa os testes em pushes para `main`, pull requests
e execuções manuais, preservando relatórios e evidências por 14 dias.
