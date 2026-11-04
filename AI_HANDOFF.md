# Manual de continuidade para IA — servidor Andre 3D

Este é o servidor de produção do jogo Andre 3D. Ele é independente do projeto Godot, mas precisa permanecer compatível com o cliente Android em `https://github.com/brechoda/Andre3D-GTA3`.

## Identidade e deploy

- Repositório: `https://github.com/brechoda/andre3d-multiplayer-server`
- Branch de produção: `main`
- Runtime: Node.js ESM
- Entrada: `server.mjs`
- Pacote: `ws`
- Comandos: `npm ci`, `npm start`, `npm test`
- Hospedagem atual: Render
- URL pública: `https://andre3d-multiplayer-server.onrender.com`
- Health check: `/health`
- WebSocket: `/ws`
- Manifesto: `/updates/manifest.json`
- Conteúdo de update: `/updates/files/...`

O Render está ligado ao repositório. Push em `main` dispara deploy automático. Depois de um push, confirme `/health` e o manifesto público; o deploy pode levar alguns segundos.

## Contrato do cliente

O build multiplayer atual é `andre3d-mp-v4`. O cliente deve enviar no primeiro evento `join`:

- `type: "join"`
- `build: "andre3d-mp-v4"`
- `app_version`, por exemplo `"2.1.1"`
- `room`
- `name`
- `character`: `andre`, `gorece` ou `dg`

O servidor rejeita build diferente com `BUILD_MISMATCH` e rejeita APK abaixo de `MIN_CLIENT_VERSION` com `CLIENT_UPDATE_REQUIRED`. A versão mínima padrão atual é `2.1.1`; ela pode ser sobrescrita pela variável de ambiente `MIN_CLIENT_VERSION` no Render quando necessário. O pacote `com.manus.andre3d.next` é a instalação principal a partir da 2.0.6; a 2.0.5 usa outro pacote e não pode ser atualizada no mesmo identificador por causa da troca de chave.

Não remover a validação de versão para “fazer funcionar” com APK antigo. Se o protocolo realmente precisar suportar uma versão anterior, planeje compatibilidade explícita e atualize os testes.

## Responsabilidades autoritativas

O servidor mantém salas e jogadores, retransmite estados e valida regras que não podem ficar somente no cliente:

- limite de 8 jogadores por sala;
- sequência de estados e relay imediato;
- pulo como evento com limite de 250 ms;
- posse exclusiva de veículos por sala;
- IDs estáveis de veículos: `pop100_01`, `wayfarer_01`, `hilux_01`, `fiatuno_01`;
- DG pode usar Pop 100 e Wayfarer, mas não pode reservar ou pilotar a Hilux;
- eventos de combate têm limite de frequência, ataque recente, alcance e mesma sala.

O servidor ainda sincroniza principalmente estados e animações. Não afirmar que existe sistema autoritativo completo de vida/dano/collision de combate sem implementar e testar isso.

## Atualizações de conteúdo

O arquivo `updates/manifest.json` é servido estaticamente. Cada entrada em `files` deve conter:

- `path`: caminho relativo seguro usado pelo cliente;
- `url`: caminho relativo servido pelo servidor;
- `kind`: `file` para arquivo comum ou `pck` somente se o cliente souber carregá-lo;
- `size`: tamanho exato em bytes;
- `sha256`: SHA-256 em hexadecimal minúsculo.

O cliente baixa o manifesto, valida os arquivos e usa cache em `user://updates`. Um erro de rede deve ser não fatal. Nunca publicar um manifesto apontando para arquivo inexistente, hash de outra build ou URL local.

Para atualizar `config/tuning.json`:

1. Alterar `updates/files/config/tuning.json`.
2. Calcular tamanho e SHA-256.
3. Atualizar somente os campos correspondentes em `updates/manifest.json`.
4. Incrementar `manifest.version`.
5. Rodar `git diff --check` e `npm test`.
6. Fazer commit/push para `main`.
7. Aguardar Render e consultar o manifesto público.

Exemplo para recalcular um arquivo:

```bash
python3 - <<'PY'
import hashlib
from pathlib import Path
p = Path('updates/files/config/tuning.json')
data = p.read_bytes()
print('size =', len(data))
print('sha256 =', hashlib.sha256(data).hexdigest())
PY
```

## Atualizações do próprio APK

O bloco `client` do manifesto informa o APK mais novo:

- `version`: versão exibida ao jogador;
- `code`: version code Android;
- `url`: asset de GitHub Release;
- `size`: tamanho do APK publicado;
- `sha256`: hash do mesmo APK;
- `mandatory_online`: metadado; o cliente atual não força a instalação do APK por esse campo.

O cliente usa `min_online_version` como gate online; o servidor aplica `MIN_CLIENT_VERSION` (padrão `2.1.1`, sobrescrevível no Render). Alinhe os dois quando for necessário forçar uma migração. Neste release, `min_online_version` permanece `2.1.7`; o APK atual é `2.2.11`, código Android `43`, na release `apk-v2.2.11` e asset `Andre3D-2.2.11.apk` (125378582 bytes; SHA-256 `eafcb30ca5174b177f3e9fca25f649c4b127d452a68b6177d7d1745a89a334f9`).

Quando um novo APK for criado, primeiro publique o asset no GitHub Release e só depois atualize o manifesto. O hash deve ser calculado no arquivo final publicado:

```bash
APK=/caminho/Andre3D-X.Y.Z.apk
stat -c '%s' "$APK"
sha256sum "$APK"
```

Se a nova versão passar a ser obrigatória para multiplayer, atualize também `MIN_CLIENT_VERSION` ou a variável correspondente no ambiente Render. O servidor só deve exigir a nova versão quando o asset estiver disponível para download.

## Testes

```bash
npm ci
npm test
node --check server.mjs
```

O teste `test_vehicle_claims.mjs` inicia um servidor local, verifica que 2.0.5 é recusado e conecta clientes concorrentes com `app_version: "2.1.1"` para validar relay imediato, identidade DG, acesso às motos, bloqueio da Hilux, estado stale, pulo e posse exclusiva.

Ao alterar a validação de versão, inclua casos para:

- versão mínima aceita;
- versão antiga rejeitada com `CLIENT_UPDATE_REQUIRED`;
- versão com campos ausentes tratada como antiga;
- build incompatível rejeitado como `BUILD_MISMATCH`.

## Processo seguro de alteração

1. Ler este arquivo e o `docs/AI_HANDOFF.md` do repositório Godot.
2. Inspecionar `server.mjs`, `updates/manifest.json`, testes e `package.json`.
3. Não alterar o contrato WebSocket sem alterar o cliente Godot e os testes.
4. Rodar `git diff --check`, `node --check server.mjs` e `npm test`.
5. Commitar apenas arquivos intencionais.
6. Push para `main`.
7. Confirmar deploy via `/health`, manifesto e, quando necessário, uma conexão WebSocket.

## Rollback

O rollback mais seguro é reverter o commit no GitHub e aguardar novo deploy do Render. Para conteúdo, restaure o manifesto e os arquivos com o hash anterior. Para uma exigência de versão incorreta, restaure `min_online_version` e `MIN_CLIENT_VERSION` para a última versão funcional, publique o APK correto e depois reative o gate.

Não excluir releases ou sobrescrever assets sem saber qual APK está instalado pelos usuários. Releases são a origem dos downloads do atualizador.

## Estado atual entregue

- Build: `andre3d-mp-v4`.
- Gate do cliente: `min_online_version` `2.1.7`; gate padrão do servidor: `MIN_CLIENT_VERSION` `2.1.1`.
- Manifesto atual: `2026.11.04.9`; configuração de spawn: `global-10`, apenas região `center`, verificada contra COL1 do PCK.
- APK atual: `2.2.11`, código Android `43`, package id `com.manus.andre3d.next`.
- PCK de mapa CENTRO: release `map-v2.2.0-regions`, 62.817.264 bytes, SHA-256 `1ccc94887ffdc3318813cea0896d366dc6373a9705da5a74d79083dcf7caa356`; o manifesto atual publica apenas esta região.
- Health esperado: `ok: true`, build `andre3d-mp-v4`.
- Release pública do APK: `apk-v2.2.11` (125378582 bytes; SHA-256 `eafcb30ca5174b177f3e9fca25f649c4b127d452a68b6177d7d1745a89a334f9`).
- Segurança da assinatura: a keystore de produção foi exposta no histórico público deste repositório (commit `f8f69b8`) e removida do `main` em `e9ae5b7`; os commits antigos continuam acessíveis. A 2.2.11 foi assinada com essa chave por autorização explícita do proprietário. Trate a chave como comprometida e planeje uma migração antes de futuros releases; nunca registrar a senha ou a keystore.

Mantenha esta documentação atualizada sempre que mudar endpoint, protocolo, versão mínima, fluxo de release, formato do manifesto ou comando de deploy.
