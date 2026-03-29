# 🚀 Próximos Passos - VideoComposer Implementado

Parabéns! O **VideoComposer** foi completamente implementado e integrado ao seu projeto. Aqui está o mapa de ação para colocar em produção.

## 📋 Checklist de Implementação

### ✅ Concluído (Você tem agora)
- [x] Interface `IVideoComposer` definida
- [x] `FFmpegVideoComposer` com suporte completo a placeholders
- [x] Integração no `PublicacaoService`
- [x] Injeção de dependência automática
- [x] Geração de vídeos finais em `/tmp/{jobId}/final-output.mp4`
- [x] Sincronização de áudio + vídeo
- [x] Concatenação de partes
- [x] Documentação completa

### ⚠️ Faltando (Para próximas sprints)
- [ ] Instalar FFmpeg em produção
- [ ] Criar endpoint para upload de B-roll
- [ ] Testar com vídeos reais do frontend
- [ ] Otimizar resoluções por plataforma
- [ ] Integrar avatar/apresentadora real
- [ ] Adicionar lipsync
- [ ] Customizar placeholders

---

## 🔧 Instalação de FFmpeg

### Desenvolvimento (Local)
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
# Baixe de https://ffmpeg.org/download.html
```

### Produção (Docker/Container)
```dockerfile
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# ...resto do Dockerfile
```

### Verificar Instalação
```bash
ffmpeg -version
# Deve mostrar: ffmpeg version N-xxxxx Copyright...
```

---

## 🎬 Primeiro Teste

### 1. Iniciar a Aplicação
```bash
npm run dev
```

Esperado:
```
[orchestrator] Starting...
[orchestrator] Queue connected
[orchestrator] API server started
API listening on http://localhost:3000 (env=development)
```

### 2. Enviar Requisição de Teste
```bash
curl -X POST http://localhost:3000/jobs/form \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "title": "Teste VideoComposer",
    "platforms": ["youtube"],
    "idea": "Um vídeo para testar a geração de vídeo com áudio TTS e placeholders"
  }'
```

Esperado (resposta):
```json
{"requestId": "abc123..."}
```

### 3. Monitorar Logs
Deve ver:
```
[publicacao] Start abc123...
[workflow] Generating roteiro plan
[workflow] Plan ready 5
[workflow] TTS ready 1
[workflow] TTS ready 2
[workflow] TTS ready 3
[workflow] TTS ready 4
[workflow] TTS ready 5
[workflow] Composing video from TTS assets
[video-composer] Starting composition for job abc123...
[video-composer] Creating placeholder video for part 1
[video-composer] Creating talking head video for part 1
[video-composer] Syncing audio for part 1
... (mais sincronizações)
[video-composer] Creating concat demux file
[video-composer] Concatenating videos
[video-composer] Video composition completed /tmp/abc123.../final-output.mp4
[publicacao] Publishing youtube
[publicacao] Published youtube
Publish completed abc123... [{ platform: 'youtube', status: 'success' }]
```

### 4. Verificar Vídeo Gerado
```bash
# Listar arquivos
ls -lh tmp/{jobId}/

# Deve incluir:
# -rw-r--r-- final-output.mp4  (alguns MB)

# Verificar com FFmpeg
ffprobe tmp/{jobId}/final-output.mp4
```

---

## 🎥 Próxima Feature: Upload de B-roll

Para melhorar a qualidade dos vídeos, você vai querer permitir que o frontend envie seus próprios vídeos de B-roll.

### Sugestão de Implementação

#### 1. Criar Endpoint de Upload
```typescript
// src/infrastructure/http/ApiServer.ts

app.post("/jobs/:jobId/broll", upload.single("video"), (req: Request, res: Response) => {
  if (!req.file || !req.params.jobId) {
    return res.status(400).send("Missing file or jobId");
  }

  const jobId = req.params.jobId;
  const partId = req.body.partId || "1"; // Parte que corresponde
  
  const outputPath = path.join(
    config.workflowOutputDir,
    jobId,
    `part-${partId}.mp4`
  );

  // Salvar arquivo
  fs.writeFileSync(outputPath, req.file.buffer);

  return res.status(200).json({ 
    success: true, 
    path: outputPath,
    partId 
  });
});
```

#### 2. Chamada do Frontend
```javascript
// Após submeter o formulário com a ideia
const formData = new FormData();
formData.append("video", videoFile); // Arquivo MP4 do usuário
formData.append("partId", "2"); // Qual parte do roteiro?

fetch(`/jobs/${jobId}/broll`, {
  method: "POST",
  body: formData
})
.then(res => res.json())
.then(data => console.log("B-roll enviado para parte", data.partId));
```

#### 3. VideoComposer Usará Automaticamente
Após receber o arquivo, na próxima execução do `compose()`, ele vai procurar:
- `tmp/{jobId}/part-2.mp4` ← seu vídeo
- Se encontrar: usa seu vídeo
- Se não encontrar: cria placeholder

---

## 📊 Estrutura do Resultado Final

Após o processamento completo, você terá:

```
tmp/{jobId}/
├── part-1.mp3                  # Áudios TTS (5 arquivos)
├── part-2.mp3
├── part-3.mp3
├── part-4.mp3
├── part-5.mp3
├── 
├── [OPCIONAL] part-2.mp4       # B-roll enviado pelo frontend
├── [OPCIONAL] part-3.mp4       #
├──
├── placeholder-1.mp4           # Ou seus vídeos de B-roll acima
├── placeholder-3.mp4           #
├── talking-head-1.mp4          # Vídeos gerados para talking heads
├── talking-head-4.mp4          #
├── talking-head-5.mp4          #
├──
├── synced-part-1.mp4           # Áudio + vídeo sincronizados
├── synced-part-2.mp4           #
├── synced-part-3.mp4           #
├── synced-part-4.mp4           #
├── synced-part-5.mp4           #
├──
├── concat.txt                  # Lista de partes para concatenação
└── final-output.mp4            # ✅ VÍDEO FINAL PRONTO
```

---

## 🎯 Objetivos de Curto Prazo

### Sprint 1 - Validação (Esta semana)
- [ ] Instalar FFmpeg em produção
- [ ] Testar fluxo completo 5+ vezes
- [ ] Validar qualidade do vídeo gerado
- [ ] Verificar sincronização áudio/vídeo
- [ ] Documentar issues encontradas

### Sprint 2 - B-roll (Próxima semana)
- [ ] Criar endpoint `/jobs/{jobId}/broll` para upload
- [ ] Testar upload de vídeos reais
- [ ] Validar uso automático de B-roll pelo VideoComposer
- [ ] Otimizar tamanhos de arquivo

### Sprint 3 - Qualidade (Semana 3)
- [ ] Adaptar resolução por plataforma:
  - YouTube: 1920x1080 (16:9)
  - TikTok: 1080x1920 (9:16)
  - Instagram Reels: 1080x1920 (9:16)
- [ ] Ajustar bitrates conforme plataforma
- [ ] Adicionar logos/watermarks

---

## 🔍 Monitoramento e Logs

Para debugar problemas, procure por logs com `[video-composer]`:

```bash
# Ver apenas logs do VideoComposer
npm run dev 2>&1 | grep "video-composer"

# Ou salvar em arquivo
npm run dev 2>&1 | tee output.log
grep "video-composer" output.log
```

---

## 🆘 Troubleshooting

### Erro: "ffmpeg command not found"
```bash
# Instalar FFmpeg
sudo apt-get install ffmpeg

# Verificar caminho
which ffmpeg
```

### Erro: "Cannot find module FFmpegVideoComposer"
```bash
# Verificar se arquivo foi criado
ls -la src/infrastructure/external/FFmpegVideoComposer.ts

# Recompilar TypeScript
npm run build
```

### Vídeo saindo com qualidade ruim
Aumentar bitrate em `.env`:
```env
VIDEO_BITRATE=8000k    # De 5000k para 8000k
AUDIO_BITRATE=192k     # De 128k para 192k
VIDEO_PRESET=slow      # De medium para slow (melhor qualidade)
```

---

## 📚 Documentação de Referência

- [VIDEO_COMPOSER.md](./VIDEO_COMPOSER.md) - Guia técnico completo
- [FLUXO_VISUAL.md](./FLUXO_VISUAL.md) - Diagrama visual do fluxo
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Resumo técnico

---

## 🎉 Você Está Pronto!

O `VideoComposer` está completamente implementado e pronto para uso. O próximo passo é:

1. **Testar** com dados reais
2. **Iterar** com feedback do frontend
3. **Expandir** com mais recursos (avatar, lipsync, etc.)

Bom trabalho! 🚀
