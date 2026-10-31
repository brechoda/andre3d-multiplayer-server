# Conteúdo remoto do Andre 3D

`manifest.json` é servido pelo próprio servidor multiplayer em `/updates/manifest.json`.
Os arquivos são baixados pelo APK para `user://updates`, verificados pelo tamanho e SHA-256 e ativados somente depois de concluídos.

Para publicar um arquivo novo:

1. Coloque-o em `updates/files/`.
2. Atualize `manifest.json` com `path`, `url`, `kind`, `size` e `sha256`.
3. Faça commit e push neste repositório.
4. Aguarde o deploy do Render.

Arquivos `kind: "pck"` são carregados como resource packs do Godot. Arquivos comuns ficam disponíveis no cache remoto para consumidores que chamarem `RemoteUpdater.read_remote_text()` ou abrirem o caminho correspondente.
