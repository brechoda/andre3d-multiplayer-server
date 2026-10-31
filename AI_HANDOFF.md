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
- IDs estáveis de veículos: `pop100_01`, `wayfarer_01`, `hilux_01`;
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
- `mandatory_online`: indica que a versão é necessária para multiplayer.

O campo `min_online_version` deve ser igual à menor versão que o servidor aceita. O APK atual está em GitHub Release `v2.1.1` e o asset é `Andre3D-2.1.1.apk`.

Quando um novo APK for criado, primeiro publique o asset no GitHub Release e só depois atualize o manifesto. O hash deve ser calculado no arquivo final publicado:

```bash
APK=/caminho/Andre3D-X.Y.Z.apk
stat -c '%s' "$APK"
sha256sum "$APK"
```

Depois atualize também `MIN_CLIENT_VERSION` ou a variável correspondente no ambiente Render. O servidor deve exigir a nova versão somente quando o asset estiver disponível para download.

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
- Versão mínima online: `2.1.1`.
- Manifesto atual: `2026.10.31.9`.
- APK atual: `2.1.1`, código Android `13`, package id `com.manus.andre3d.next`.
- Health esperado: `ok: true`, build `andre3d-mp-v4`.
- Commit do gate/manifesto: `64f9239`.

Mantenha esta documentação atualizada sempre que mudar endpoint, protocolo, versão mínima, fluxo de release, formato do manifesto ou comando de deploy.
