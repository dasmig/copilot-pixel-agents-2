# Publicando no VS Code Marketplace

## Fluxo automatizado (recomendado)

Desde o Sprint 2, `.github/workflows/release.yml` cuida do empacotamento e da release
a cada push de tag `vX.Y.Z`:

1. Atualize `version` em `package.json` e a seção correspondente do `CHANGELOG.md` num commit em `master`.
2. Crie e envie a tag:
   ```bash
   git tag -a v0.7.0 -m "v0.7.0"
   git push origin v0.7.0
   ```
3. O workflow valida que a tag bate com `package.json`, roda typecheck + testes, builda,
   empacota o `.vsix` e cria uma GitHub Release com o arquivo anexado.
4. Se o secret `VSCE_PAT` estiver configurado no repositório (Settings → Secrets and
   variables → Actions), o mesmo workflow publica automaticamente no Marketplace. Sem o
   secret, a Release ainda é criada com o `.vsix` pronto — só a publicação no Marketplace
   fica manual (passo 5 abaixo).

O checklist e os passos manuais continuam válidos como fallback (secret ausente, teste
local do `.vsix`, ou republicação de uma versão sem gerar uma tag nova).

## Pré-requisitos

1. Conta em https://marketplace.visualstudio.com/manage
2. Azure DevOps Personal Access Token (PAT) com escopo **Marketplace → Manage**
3. Publisher registrado com o mesmo `publisher` do `package.json` (`cl-oliveira`)
4. Para o fluxo automatizado: o PAT salvo como secret `VSCE_PAT` no repositório GitHub

## Passo a passo manual

### 1. Criar o publisher (se ainda não existir)

Acesse: https://marketplace.visualstudio.com/manage/publishers

Crie um publisher com o ID `cl-oliveira` (ou atualize `package.json` com seu ID).

### 2. Gerar o PAT

- Acesse https://dev.azure.com → User Settings → Personal Access Tokens
- New Token:
  - Name: `vsce-publish`
  - Organization: All accessible organizations
  - Scopes: Custom → **Marketplace → Manage**
  - Expiration: 1 year

### 3. Build e empacotamento

```bash
cd copilot-pixel-agents

# Instalar dependências
npm install
cd webview-ui && npm install && cd ..

# Build completo
npm run build:webview
npm run build

# Gerar .vsix
npm run package
# Isso cria: copilot-pixel-agents-0.2.0.vsix
```

### 4. Testar o .vsix localmente

```bash
# Instalar na instância atual do VS Code
code --install-extension copilot-pixel-agents-0.2.0.vsix
```

### 5. Publicar

```bash
npm run publish
# Solicitará o PAT
```

Ou com o PAT direto:

```bash
npx @vscode/vsce publish --pat <SEU_PAT> --no-dependencies
```

### 6. Atualizar versão

```bash
npm version patch   # 0.2.0 → 0.2.1
# ou
npm version minor   # 0.2.0 → 0.3.0
```

Atualizar CHANGELOG.md antes de publicar.

## Checklist antes de publicar

- [ ] `package.json`: `publisher`, `version`, `description`, `repository` corretos
- [ ] `CHANGELOG.md` atualizado
- [ ] `README.md` com screenshot ou GIF (recomendado pelo Marketplace)
- [ ] `media/icon.svg` ou `icon.png` 128×128 px
- [ ] Build sem erros: `npm run vscode:prepublish`
- [ ] Testado com F5 em modo debug
