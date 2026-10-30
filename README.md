# Servidor multiplayer Andre 3D

Servidor WebSocket Node.js para o jogo Andre 3D. Execute `npm ci` e `npm start`; a aplicação escuta em `PORT` (padrão 8080), expõe `/health` e aceita conexões em `/ws`. O cliente e o servidor precisam usar o mesmo build (`andre3d-mp-v2`).

## Veículos compartilhados

Cada veículo da cena tem um ID estável (`pop100_01`, `wayfarer_01` ou `hilux_01`). O servidor reserva cada assento exclusivamente por sala, trata pedidos `vehicle_claim` e liberações `vehicle_release`, e retransmite o ID e a posição do veículo junto ao estado do jogador. Os clientes remotos atualizam a instância de veículo já presente na cena; não criam outro carro ou moto para representar o motorista.

## Eventos de combate

O cliente envia `combat` com `action: "attack"` e um clipe permitido (`FightA_1`, `FightA_2` ou `FightA_3`) no início do soco. No impacto, envia `action: "hit"` com o ID do alvo. O servidor limita a frequência, exige um ataque recente, confirma que o alvo está na mesma sala e dentro do alcance de combate e retransmite o evento com a posição do atacante. Os clientes reproduzem visualmente a animação de ataque ou reação correspondente.

Esses eventos sincronizam **animações visuais**; não implementam pontos de vida, dano autoritativo, colisões de combate ou validação completa de direção. Para o recurso funcionar na sala hospedada, publique este `server.mjs` e use uma versão do cliente que trate mensagens `combat`.

## Testes

Execute `npm test` para iniciar clientes WebSocket concorrentes e verificar reserva exclusiva, veículo desconhecido, liberação e nova reserva. No projeto Godot, `tests/multiplayer_two_clients.gd` abre duas cenas completas contra um servidor local e verifica moto, Hilux, piloto remoto e identidade compartilhada do veículo.
