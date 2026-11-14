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
- Manifestos: `/updates/manifest.json` (cliente principal/legado) e `/updates/pistol/manifest.json` (variante Pistola)
- Conteúdo de update: `/updates/files/...`

O Render está ligado ao repositório. Push em `main` dispara deploy automático. Depois de um push, confirme `/health` e ambos os manifests públicos; o deploy pode levar alguns segundos.

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

Os arquivos `updates/manifest.json` e `updates/pistol/manifest.json` são servidos estaticamente. Cada variante usa seu próprio manifesto; conteúdo compartilhado, como spawn e PCK CENTRO, deve permanecer coerente nos dois. Cada entrada em `files` deve conter:

- `path`: caminho relativo seguro usado pelo cliente;
- `url`: caminho relativo servido pelo servidor;
- `kind`: `file` para arquivo comum ou `pck` somente se o cliente souber carregá-lo;
- `size`: tamanho exato em bytes;
- `sha256`: SHA-256 em hexadecimal minúsculo.

O cliente baixa o manifesto, valida os arquivos e usa cache em `user://updates`. Um erro de rede deve ser não fatal. Nunca publicar um manifesto apontando para arquivo inexistente, hash de outra build ou URL local.

Para atualizar `config/tuning.json`:

1. Alterar `updates/files/config/tuning.json`.
2. Calcular tamanho e SHA-256.
3. Atualizar os campos correspondentes em ambos os manifests se o arquivo for usado pelos dois clientes; caso contrário, atualizar apenas o manifesto da variante que o consome.
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

O bloco `client` informa o APK anunciado por cada variante. O manifesto principal (`updates/manifest.json`) usa assets de GitHub Release; o manifesto Pistola (`updates/pistol/manifest.json`) pode usar sua URL CDN independente. Em ambos os casos, confira o arquivo final contra `size` e `sha256`.

- `version`: versão exibida ao jogador;
- `code`: version code Android;
- `url`: URL pública do asset de APK;
- `size`: tamanho do APK publicado;
- `sha256`: hash do mesmo APK;
- `mandatory_online`: metadado; o cliente atual não força a instalação do APK por esse campo.

O cliente usa `min_online_version` como gate online; o servidor aplica `MIN_CLIENT_VERSION` (padrão `2.1.1`, sobrescrevível no Render). Alinhe os dois quando for necessário forçar uma migração. Estado verificado em 2026-11-10: o manifesto principal `2026.11.07.1` anuncia cliente `2.2.13`, código `45`, release `apk-v2.2.13`; o manifesto Pistola `2026.11.09.4` (`andre3d-pistol`, `min_app_version` `3.0.0`) anuncia cliente `3.0.5` via CDN (`131086654` bytes; SHA-256 `49f2b8df27c151c57b7516fc9348ec2882d0c1475c6dd7c6cf03102a6a167558`). O APK CDN foi baixado e conferido nesta auditoria. A fonte do cliente Pistola já está em `3.0.6`, mas o CI só produz artefato debug.

Quando um novo APK for criado, primeiro publique o asset no destino correspondente (GitHub Release para o cliente principal ou CDN configurado para Pistola) e só depois atualize o manifesto dessa variante. O hash deve ser calculado no arquivo final publicado:

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
- Gate padrão do servidor: `MIN_CLIENT_VERSION` `2.1.1`; `min_online_version` é `2.1.7` nos manifests ativos.
- Manifests vivos: principal `2026.11.07.1`, cliente `2.2.13`/código `45`; Pistola `2026.11.09.4`, variante `andre3d-pistol`, `min_app_version` `3.0.0`, cliente `3.0.5` por CDN (131.086.654 bytes; SHA-256 `49f2b8df27c151c57b7516fc9348ec2882d0c1475c6dd7c6cf03102a6a167558`). O arquivo CDN conferiu contra tamanho e hash.
- Ambos os manifests listam somente CENTRO; Level 2 não está atualmente disponível para download/seleção. Spawn remoto `global-13`: André `[184.73, 3.3474, -22.03]`, Gorece `[185.0, 3.3474, -19.0]`; os 12 pontos locais/remotos passaram sobre COL1 com gap máximo `0.000 m`.
- PCK CENTRO ativo: release [`map-v2.2.2-spawn-fix`](https://github.com/brechoda/andre3d-multiplayer-server/releases/tag/map-v2.2.2-spawn-fix), 62.720.388 bytes, SHA-256 `fc38ae751ea53c8795c222436ff7f332916a79eae5086521ced0ba7037cab26e`. Liberty City permanece parcial: quatro de 12 tiles-base estão no PCK; oito não estão publicados. O checkout do jogo contém conjuntos candidatos `landne`/`landsw`, mas eles estão fora dos catálogos/regiões/PCK e não foram validados como jogáveis.
- Fonte cliente Pistola: versão `3.0.6`, código Android `7`, package id `com.manus.andre3d.pistol`; o workflow produz apenas artefato debug. A última GitHub Release principal é `apk-v2.2.13` (131.069.890 bytes; SHA-256 `8805400706d04e6a02a9375ef254c2ed6b62e0645ae8d48ee16306668c737da2`).
- O repositório do jogo também publicou [`pistol-v3.0.0`](https://github.com/brechoda/Andre3D-game/releases/tag/pistol-v3.0.0), asset debug baseado numa tag antiga cujo menu ainda mostra Level 2. O manifesto Pistola anuncia 3.0.5; o cliente 3.0.0 trata essa versão superior como atualização obrigatória e bloqueia o início do jogo até instalá-la. O update de conteúdo continua fornecendo somente CENTRO.
- Health verificado: `ok: true`, build `andre3d-mp-v4`; `node --check` e `npm test` passaram. A suíte também garante igualdade do PCK/spawn publicados nas duas variantes.
- Pendências: playtest visual e Android físico para download, streaming, vidro, desempenho e controles; reconciliar os oito tiles fora do PCK com a lista-fonte, integrar/validar os candidatos `landne`/`landsw` e localizar os demais assets antes de declarar Liberty City completa. Reativar Level 2 exige nova validação de colisões, memória e desempenho em dispositivo real.
- Segurança da assinatura: a keystore de produção foi exposta no histórico público deste repositório (commit `f8f69b8`) e removida do `main` em `e9ae5b7`; os commits antigos continuam acessíveis. A 2.2.13 foi assinada com essa chave. Trate-a como comprometida e planeje uma migração antes de futuros releases; nunca registrar a senha ou a keystore.

Mantenha esta documentação atualizada sempre que mudar endpoint, protocolo, versão mínima, fluxo de release, formato do manifesto ou comando de deploy.
