# Servidor multiplayer Andre 3D

Servidor WebSocket Node.js para o jogo Andre 3D. Execute `npm ci` e `npm start`; a aplicação escuta em `PORT` (padrão 8080), expõe `/health` e aceita conexões em `/ws`. O cliente e o servidor usam o build `andre3d-mp-v1`.

## Eventos de combate

O cliente envia `combat` com `action: "attack"` e um clipe permitido (`FightA_1`, `FightA_2` ou `FightA_3`) no início do soco. No impacto, envia `action: "hit"` com o ID do alvo. O servidor limita a frequência, exige um ataque recente, confirma que o alvo está na mesma sala e dentro do alcance de combate e retransmite o evento com a posição do atacante. Os clientes reproduzem visualmente a animação de ataque ou reação correspondente.

Esses eventos sincronizam **animações visuais**; não implementam pontos de vida, dano autoritativo, colisões de combate ou validação completa de direção. Para o recurso funcionar na sala hospedada, publique este `server.mjs` e use uma versão do cliente que trate mensagens `combat`.
