# Servidor multiplayer Andre 3D

Servidor WebSocket Node.js para o jogo Andre 3D. Execute `npm ci` e `npm start`; a aplicação escuta em `PORT` (padrão 8080), expõe `/health`, serve atualizações em `/updates/manifest.json` e aceita conexões em `/ws`. O cliente e o servidor precisam usar o mesmo build (`andre3d-mp-v4`), que reconhece André, Gorece e DG e bloqueia a Hilux para DG.

Para outra IA continuar o deploy, o protocolo, o gate de versão, o manifesto e o fluxo de releases, leia o [Manual de continuidade para IA](AI_HANDOFF.md) antes de alterar o servidor.

## Atualizações remotas do APK

O APK preparado para atualizações consulta `https://andre3d-multiplayer-server.onrender.com/updates/manifest.json` ao abrir. O manifesto valida cada arquivo por tamanho e SHA-256; arquivos `kind: "file"` ficam no cache `user://updates/files` e pacotes `kind: "pck"` são carregados pelo Godot como resource packs. Para publicar conteúdo, altere `updates/files/`, regenere os campos `size` e `sha256` no manifesto, faça commit/push e aguarde o deploy do Render. Se o servidor ou o download falhar, o jogo usa o conteúdo instalado anteriormente e continua abrindo.

## Movimento e pulo

O cliente publica o estado numerado a 30 Hz, com posição, velocidade e latência estimada. O servidor valida sequências e retransmite cada pose imediatamente, em vez de aguardar um tick de 50 ms; se um cliente acumular mais de 64 KiB de poses pendentes, poses antigas são descartadas para ele receber a próxima atualização recente. O cliente remoto prevê no máximo 200 ms à frente e suaviza pequenos erros, aplicando snap apenas no primeiro estado ou quando a correção passa de 1,6 m (3 m para veículos). O pulo é um evento único no takeoff, retransmitido uma vez por sala e limitado a uma ocorrência a cada 250 ms.

## Veículos compartilhados

Cada veículo da cena tem um ID estável (`pop100_01`, `wayfarer_01` ou `hilux_01`). O servidor reserva cada assento exclusivamente por sala, trata pedidos `vehicle_claim` e liberações `vehicle_release`, e retransmite o ID e a posição do veículo junto ao estado do jogador. Os clientes remotos atualizam a instância de veículo já presente na cena; não criam outro carro ou moto para representar o motorista.

## Personagem DG

O build v4 reconhece André, Gorece e DG. DG pode reservar as motos Pop 100 e Wayfarer, mas o servidor rejeita `hilux_01` tanto na reserva quanto em um estado de pilotagem enviado diretamente; isso evita contornar a restrição do cliente.

## Eventos de combate

O cliente envia `combat` com `action: "attack"` e um clipe permitido (`FightA_1`, `FightA_2` ou `FightA_3`) no início do soco. No impacto, envia `action: "hit"` com o ID do alvo. O servidor limita a frequência, exige um ataque recente, confirma que o alvo está na mesma sala e dentro do alcance de combate e retransmite o evento com a posição do atacante. Os clientes reproduzem visualmente a animação de ataque ou reação correspondente.

Esses eventos sincronizam **animações visuais**; não implementam pontos de vida, dano autoritativo, colisões de combate ou validação completa de direção. Para o recurso funcionar na sala hospedada, publique este `server.mjs` e use uma versão do cliente que trate mensagens `combat`.

## Testes

Execute `npm test` para iniciar clientes WebSocket concorrentes e verificar identidade DG, acesso às motos, bloqueio da Hilux inclusive via estado forçado, reserva exclusiva, relay imediato, rejeição de sequência antiga e retransmissão única do pulo. No projeto Godot, `tests/multiplayer_two_clients.gd` abre duas cenas completas contra um servidor local e verifica moto, Hilux, pulo remoto e identidade compartilhada do veículo.
