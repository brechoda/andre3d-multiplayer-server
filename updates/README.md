# Conteúdo remoto do Andre 3D

`manifest.json` é servido pelo próprio servidor multiplayer em `/updates/manifest.json`. Os arquivos são baixados para `user://updates`, validados por tamanho e SHA-256 e só ficam disponíveis ao jogo depois da verificação.

Para publicar um arquivo novo:

1. Coloque-o em `updates/files/`.
2. Atualize `manifest.json` com `path`, `url`, `kind`, `size` e `sha256`.
3. Aumente `version` no manifesto.
4. Faça commit e push neste repositório e aguarde o deploy do Render.

Arquivos `kind: "pck"` são carregados como resource packs. O PCK de runtime fica abaixo dos recursos do APK e não substitui scripts/UI já embarcados. Arquivos comuns ficam no cache remoto e podem ser lidos pelo cliente por `RemoteUpdater.read_remote_text()`.

## Configuração remota de HUD e menu

Edite `updates/files/config/remote_ui.json` para atualizar a aparência da interface sem publicar um APK novo. O APK que implementa `RemoteUIConfig` consulta esse arquivo após baixar e validar o manifesto e aplica a configuração na próxima inicialização.

O formato atual usa `schema_version: 1`, uma `revision` curta e o objeto `elements`. Cada chave deve ser um ID já registrado pelo APK (`menu.*` ou `hud.*`). Propriedades disponíveis incluem visibilidade para elementos autorizados, texto estático, rótulos dos itens já existentes de seletores, `text_color`, `background_color`, `tint`, `font_size`, `scale`, `position`, `size` e `min_size`. Posições, tamanhos, escala, fontes e comprimento de textos são limitados pelo cliente; IDs desconhecidos e propriedades não reconhecidas são ignorados.

A configuração não executa GDScript, não aceita NodePaths e não cria controles. O botão de entrada e o botão de instalação obrigatória do APK não podem ser ocultados remotamente. Mudanças de comportamento, novos controles ou novos IDs precisam de atualização do APK. Depois de editar o JSON, recalcule o `size` e o SHA-256 correspondente no manifesto, faça commit/push e aguarde o deploy.
