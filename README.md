# Conferência Laboratório

Versão para GitHub com exemplos fictícios. Nenhum banco, laudo, planilha operacional, arquivo importado ou histórico Git anterior foi incluído.

As pastas originais usadas na operação foram preservadas. Credenciais devem ser configuradas apenas localmente.

## Demonstração local

Requer Node.js >= 22.13, pnpm e Java para os emuladores Firebase.

```sh
pnpm install
pnpm dev:reports:demo
# Em outro terminal:
pnpm seed:reports:demo
```

Abra http://127.0.0.1:3000. Login exclusivo do emulador: `demo@example.com` / `SomenteLocal2026!`. Não use essa senha em produção. A demonstração usa o projeto local `demo-client-reports`.

```sh
pnpm test
pnpm typecheck
pnpm build
```

Para um ambiente próprio, preencha `.env.local` a partir de `.env.example`; o domínio permitido deste exemplo é `example.com`. Os serviços PDF e IA são opcionais e exigem configuração separada. Os modelos fictícios servem apenas para demonstração e não possuem homologação técnica.

## Distribuição para GitHub

Esta cópia foi preparada com dados fictícios, sem arquivos de produção ou histórico Git anterior. Os cadastros, responsáveis, identificadores e referências a espaços privados foram substituídos; os documentos originais de clientes e os testes que dependem deles não integram esta distribuição. As pastas originais foram preservadas.

Os testes locais foram executados com as dependências já instaladas na máquina. A validação completa de build, serviços e hospedagem em ambiente novo permanece pendente.
