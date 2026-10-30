# Conferência Laboratório

Aplicação web para conferir medições e documentos laboratoriais, analisar divergências e organizar relatórios ambientais em um único fluxo de revisão.

**Projeto de portfólio · dados fictícios · demonstração com emuladores locais**

## O problema

Uma conferência manual pode envolver um PDF de medição, várias planilhas de coleta, revisões da mesma amostra e laudos com datas diferentes. A comparação repetitiva favorece duplicidades, cobranças divergentes e perda de rastreabilidade.

O sistema cruza as fontes e destaca o que precisa de decisão humana. Em áreas separadas, também organiza a análise de conformidade e a preparação de relatórios mensais.

## Funcionalidades

- **Conferência documental:** leitura de PDF e Excel no navegador, consolidação de amostras e comparação por número-base, considerando revisões.
- **Tratamento de divergências:** filtros e decisões de pendência, aprovação ou contestação, com comentário obrigatório para contestar.
- **Rastreabilidade:** histórico de conferências, identificação das fontes e eventos de auditoria no Firestore.
- **Conformidade:** interpretação de laudos, associação a pontos de coleta e comparação com regras versionadas, mantendo inconsistências e dados insuficientes visíveis.
- **Acompanhamento mensal:** organização de análises, datas de coleta e publicação, periodicidades e pendências.
- **Relatórios ambientais:** seleção de cliente e competência, importação de resultados e registros operacionais, gráficos, revisão de conclusões e exportação para Word, PDF e Excel, conforme o módulo.

## Fluxo de uso

1. Entrar no ambiente de demonstração.
2. Escolher a área: conferência, conformidade, acompanhamento ou relatórios.
3. Importar fontes fictícias e revisar as divergências apresentadas.
4. Registrar decisões e conferir a prévia antes da exportação.

A análise automatizada apoia a revisão. O programa preserva resultados e não substitui informações ausentes por valores presumidos.

## Tecnologias e estrutura

| Camada | Implementação |
| --- | --- |
| Interface | React 19, Next.js 16 e TypeScript |
| Identidade e persistência | Firebase Authentication, Firestore e regras de acesso |
| Documentos | pdfjs-dist, SheetJS, docx e jsPDF |
| Serviços opcionais | Firebase Functions, serviço PDF com Playwright e integração de IA no backend |
| Testes | Node.js Test Runner e emuladores Firebase |

- `app/`: telas e fluxos de revisão.
- `lib/`: importação, correspondência, validações, cálculos e exportações.
- `backend/` e `functions/`: autorização e serviços de relatórios.
- `services/report-pdf/`: renderização de PDF em serviço separado.
- `tests/`: testes unitários e exemplos sintéticos.

## Executar a demonstração local

Ambiente de testes usado nesta preparação: Node.js 24. O projeto declara pnpm 11.9.0 e utiliza Java para os emuladores Firebase.

```sh
pnpm install
pnpm dev:reports:demo
```

Em outro terminal, na mesma pasta:

```sh
pnpm seed:reports:demo
```

Abra **http://127.0.0.1:3000**.

| Campo | Valor exclusivo da demonstração |
| --- | --- |
| E-mail | `demo@example.com` |
| Senha | `SomenteLocal2026!` |
| Projeto Firebase | `demo-client-reports` |

Essa conta existe nos emuladores locais. Os modelos ficam identificados como demonstração, sem homologação para emissão operacional.

Para configurar um ambiente próprio, use `.env.example` e `.firebaserc.example`. O domínio permitido no exemplo é `example.com`. A integração de IA permanece desativada até configuração específica; nenhum serviço de produção está associado a esta cópia.

## Testes e estado de validação

```sh
pnpm test
pnpm typecheck
pnpm build
```

Na preparação desta versão, **189 testes do laboratório passaram**, utilizando as dependências já instaladas na máquina. Os testes que exigiam documentos privados foram excluídos da distribuição.

A validação completa de tipos e build em instalação limpa permanece pendente. A tentativa local de validar os tipos ficou limitada pela resolução de dependências dos serviços separados. Os serviços PDF/IA, a implantação e as regras dos emuladores devem ser configurados e validados no ambiente de destino.

## Privacidade dos exemplos

O catálogo foi recriado com nomes, responsáveis, endereços e textos fictícios. Identificadores de clientes e referências a espaços privados foram substituídos. Os rascunhos de demonstração são sintéticos.

Não acompanham o repositório: laudos, planilhas, bancos reais, arquivos importados, credenciais, configurações locais, estados de emuladores, logs ou histórico Git anterior. As pastas originais de operação foram preservadas.

## Decisões de implementação

- Separar conferência de faturamento e conformidade evita misturar resultados com finalidades diferentes.
- Preservar as fontes e registrar decisões torna a revisão verificável.
- Tratar ambiguidades como pendências reduz associações silenciosas incorretas.
- Usar emuladores permite demonstrar o fluxo sem conectar o portfólio à base operacional.
