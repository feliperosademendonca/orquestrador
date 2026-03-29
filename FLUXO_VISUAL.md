```
╔════════════════════════════════════════════════════════════════════════════════╗
║            ORQUESTRADOR - FLUXO GENUINAMENTE NON-BLOCKING v2                   ║
╚════════════════════════════════════════════════════════════════════════════════╝

⏱️  TIMELINE COMPLETA:

T=0ms
│
├─ Cliente: POST /jobs
│  └─ Validação + Enfileiramento
│     └─ Retorna: { requestId: "abc-123" } (202 Accepted)
│
├─ T=0-2s: Gemini gera roteiro (5 partes)
├─ T=2-5s: GoogleTTS gera 5 áudios (concorrência=2)
├─ T=5-5.5s: FFmpeg concatena áudios
├─ T=5.5-5.6s: Veo.startVideoGeneration() (NÃO AGUARDA!)
│              └─ Retorna imediatamente
│
└─ T=6-10s: Publicação
   ├─ YouTube (texto + áudio)
   ├─ TikTok (texto + áudio)  
   ├─ Instagram (texto + áudio)
   └─ Job finaliza
      └─ Status: COMPLETED

✅ T=10s: CLIENTE RECEBE RESPOSTA
   └─ Job já finalizado
   └─ Conteúdo já publicado em redes

════════════════════════════════════════════════════════════════════════════════

ENQUANTO ISSO, EM BACKGROUND (não bloqueia nada):

T=10s - T=30m: Veo.pollOperation()
│
├─ Polling a cada 10 segundos
├─ Não bloqueia cliente
├─ Não bloqueia servidor
│
└─ T=30m: Vídeo pronto!
   ├─ Emite evento "video-ready"
   ├─ Chama webhook: POST /webhooks/veo-video-ready
   │  └─ Envia videoBase64 + videoPath
   │
   └─ Handler webhook:
      └─ Salva vídeo em: tmp/{jobId}/veo-output.mp4
      └─ Opcional: Re-publica com vídeo em melhor qualidade

════════════════════════════════════════════════════════════════════════════════

COMPARAÇÃO: ANTES vs DEPOIS

┌─────────────────────┬─────────────────────┐
│ ❌ ANTES (Bloqueio) │ ✅ DEPOIS (Async)   │
├─────────────────────┼─────────────────────┤
│ POST /jobs          │ POST /jobs          │
│ ├─ Gemini (1s)      │ ├─ Gemini (1s)      │
│ ├─ TTS (3s)         │ ├─ TTS (3s)         │
│ ├─ FFmpeg (0.5s)    │ ├─ FFmpeg (0.5s)    │
│ ├─ Veo.await() ⏳   │ ├─ Veo.start() ✅   │
│ │ └─ 20min bloqueio │ │ └─ 100ms retorno  │
│ ├─ Publicar (2s)    │ ├─ Publicar (2s)    │
│ └─ Resposta (20min) │ └─ Resposta (10s)   │
│                     │                     │
│ Cliente travado     │ Cliente livre       │
│ Servidor bloqueado  │ Servidor responsivo │
│ Timeout HTTP        │ Sem timeout         │
│ Um job por vez      │ Múltiplos jobs      │
└─────────────────────┴─────────────────────┘

════════════════════════════════════════════════════════════════════════════════

ENDPOINTS

1. POST /jobs
   ├─ Body: { userId, title, idea, videoUrl, platforms, avatar... }
   ├─ Resposta: { requestId } (Status 202)
   └─ Tempo: ~10 segundos

2. GET /jobs/{requestId}
   ├─ Resposta: { status, platforms, workflow... }
   └─ workflow.videoPath: null enquanto Veo processando
                          {path} quando Veo terminou

3. POST /webhooks/veo-video-ready
   ├─ Chamado AUTOMATICAMENTE por Veo quando pronto
   ├─ Body: { jobId, videoBase64, videoPath, status }
   └─ Resposta: { received: true }

════════════════════════════════════════════════════════════════════════════════

FLUXO DE EVENTOS

┌─────────────────────────────────────────────────────────────────────┐
│ Cliente                    API Server          Veo                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│ POST /jobs                                                           │
│ ────────────────────────>                                           │
│                           Enfileira job                             │
│                           ├─ Gemini                                 │
│                           ├─ TTS                                    │
│                           ├─ FFmpeg                                 │
│                           └─ Veo.start() ────────────────────>     │
│                                              (retorna jobId)        │
│                           <──────────────────                        │
│                           Job: processing                           │
│                           ├─ Publicar                               │
│                           └─ Finaliza                               │
│                                                                      │
│ <──────────────────────                                             │
│ { requestId }  (202 Accepted) após ~10s                            │
│                                                                      │
│ (cliente continua)    (Veo continua processando)                   │
│                                             polling...               │
│                                             +10s                     │
│                                             polling...               │
│                                             +10s                     │
│                                             ...                      │
│                                             PRONTO!                  │
│                           POST /webhooks/ <───────────────────────  │
│                           veo-video-ready                            │
│                           { videoBase64, ... }                      │
│                           salva vídeo                                │
│                           200 OK                                     │
│                           ────────────────────>                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```                                                                │
│  {                                                                              │
│    "userId": "user@example.com",                                               │
│    "title": "Plantão da Moda Praia - Biquínis Plus Size",                     │
│    "idea": "Anúncio de coleção nova",                                          │
│    "platforms": ["youtube", "tiktok"],                                         │
│    "tone": "jornalístico",                                                     │
│    "audience": "mulheres 25-45 anos",                                          │
│    "visualStyle": "busto de manequim em bancada"                               │
│  }                                                                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ⬇️
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2️⃣  GEMINI - GERAR PLANO DE ROTEIRO                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [workflow] Generating roteiro plan                                             │
│  GeminiAdapter.generate(prompt) → RoteiroPlan                                  │
│                                                                                  │
│  RoteiroPlan {                                                                  │
│    summary: "Roteiro de vídeo curto com tom jornalístico...",                  │
│    language: "pt-BR",                                                          │
│    totalParts: 5,                                                              │
│    partDurationSec: 5,                                                         │
│    parts: [                                                                    │
│      {                                                                         │
│        id: 1,                                                                  │
│        ttsText: "Plantão da moda praia!...",                                   │
│        visualType: "talking_head",  ← Apresentadora                            │
│        visualDirection: "Apresentadora direto para câmera...",                 │
│        brollTags: []                                                           │
│      },                                                                        │
│      {                                                                         │
│        id: 2,                                                                  │
│        ttsText: "Cada peça foi cuidadosamente desenhada...",                   │
│        visualType: "broll",  ← Vídeo de suporte                                │
│        visualDirection: "Close-up de diferentes modelos...",                   │
│        brollTags: ["biquini", "tecido", "costura"]                            │
│      },                                                                        │
│      ... (3 mais)                                                              │
│    ]                                                                           │
│  }                                                                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ⬇️
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 3️⃣  GOOGLE TTS - GERAR ÁUDIOS MP3                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [workflow] TTS ready 1                                                         │
│  [workflow] TTS ready 2                                                         │
│  [workflow] TTS ready 3                                                         │
│  [workflow] TTS ready 4                                                         │
│  [workflow] TTS ready 5                                                         │
│                                                                                  │
│  Resultado: /tmp/{jobId}/                                                      │
│    ├── part-1.mp3  (voz feminina Gemini pt-BR)                                 │
│    ├── part-2.mp3                                                              │
│    ├── part-3.mp3                                                              │
│    ├── part-4.mp3                                                              │
│    └── part-5.mp3                                                              │
│                                                                                  │
│  ✓ Configurável: GCP_TTS_VOICE="pt-BR-Neural2-C" (feminina natural)           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ⬇️
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 4️⃣  FFMPEG VIDEO COMPOSER - GERAR VÍDEO FINAL ⭐ [NOVO]                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [video-composer] Starting composition for job {jobId}                          │
│                                                                                  │
│  Para cada parte:                                                              │
│  ├─ Tipo: talking_head                                                        │
│  │  └─ Criar vídeo com:                                                       │
│  │     ├─ Fundo: Azul claro (customizável)                                    │
│  │     ├─ Texto: "Plantão da moda praia! Chegou..."                           │
│  │     └─ Duração: 5 segundos (do plano)                                      │
│  │                                                                             │
│  ├─ Tipo: broll                                                               │
│  │  └─ Procurar vídeo fornecido pelo frontend                                │
│  │     ├─ Se encontrado (part-2.mp4, part-3.mp4): usar                       │
│  │     └─ Se não encontrado: criar placeholder preto                         │
│  │                                                                             │
│  ├─ Sincronizar cada vídeo com seu áudio:                                     │
│  │  └─ ffmpeg -i {video} -i {audio} -shortest synced-part-{id}.mp4           │
│  │                                                                             │
│  └─ Concatenar todas as partes:                                              │
│     └─ ffmpeg -f concat -i concat.txt -c copy final-output.mp4                │
│                                                                                  │
│  [video-composer] Video composition completed                                   │
│                                                                                  │
│  Resultado: /tmp/{jobId}/final-output.mp4                                      │
│    ├── synced-part-1.mp4  (talking head + áudio)                              │
│    ├── synced-part-2.mp4  (broll + áudio)                                     │
│    ├── synced-part-3.mp4  (broll + áudio)                                     │
│    ├── synced-part-4.mp4  (talking head + áudio)                              │
│    ├── synced-part-5.mp4  (talking head + áudio)                              │
│    └─→ final-output.mp4  (MP4 FINAL PRONTO PARA PUBLICAÇÃO) ✅                │
│                                                                                  │
│  Metadados armazenados em WorkflowResult.finalVideoPath                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ⬇️
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 5️⃣  PLATAFORMAS - PUBLICAÇÃO DO VÍDEO FINAL                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [publicacao] Publishing youtube                                                │
│  YouTubeAdapter.publish(videoPath="/tmp/{jobId}/final-output.mp4")            │
│    → Faz upload para YouTube                                                   │
│    → Status: "success"                                                         │
│                                                                                  │
│  [publicacao] Publishing tiktok                                                 │
│  TikTokAdapter.publish(videoPath="/tmp/{jobId}/final-output.mp4")             │
│    → Faz upload para TikTok                                                    │
│    → Status: "success"                                                         │
│                                                                                  │
│  Publish completed {jobId} [                                                   │
│    { platform: 'youtube', status: 'success' },                                │
│    { platform: 'tiktok', status: 'success' }                                  │
│  ]                                                                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      ⬇️
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ✅ RESULTADO FINAL                                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  VideoPublishResult {                                                          │
│    requestId: "{jobId}",                                                       │
│    userId: "user@example.com",                                                 │
│    title: "Plantão da Moda Praia - Biquínis Plus Size",                       │
│    platforms: ["youtube", "tiktok"],                                           │
│    createdAt: "2026-03-28T21:55:19.659Z",                                     │
│    completedAt: "2026-03-28T21:55:48.123Z",  ← 28 segundos depois            │
│    results: [                                                                  │
│      { platform: "youtube", status: "success" },                              │
│      { platform: "tiktok", status: "success" }                                │
│    ],                                                                          │
│    workflow: {                                                                 │
│      plan: { ... },  ← Plano detalhado com 5 partes                           │
│      assets: [ ... ],  ← Caminhos dos áudios TTS                              │
│      finalVideoPath: "/tmp/{jobId}/final-output.mp4"  ← ⭐ NOVO                │
│    }                                                                           │
│  }                                                                              │
│                                                                                  │
│  🎬 Vídeo disponível para download/visualização                                │
│  📱 Publicado no YouTube e TikTok automaticamente                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘


╔════════════════════════════════════════════════════════════════════════════════╗
║                         ARQUIVOS CRIADOS/MODIFICADOS                           ║
╚════════════════════════════════════════════════════════════════════════════════╝

✨ NOVOS ARQUIVOS:
  ├── src/application/interfaces/IVideoComposer.ts
  │   └─ Interface para qualquer compostor de vídeo
  │
  ├── src/infrastructure/external/FFmpegVideoComposer.ts
  │   ├─ Implementação com FFmpeg
  │   ├─ Cria placeholders (preto, talking head)
  │   ├─ Sincroniza áudio + vídeo
  │   └─ Concatena partes em MP4 final
  │
  ├── VIDEO_COMPOSER.md
  │   └─ Documentação técnica completa
  │
  └── test-video-composer.sh
      └─ Script de teste com FFmpeg

📝 ARQUIVOS MODIFICADOS:
  ├── src/application/services/PublicacaoService.ts
  │   ├─ +import IVideoComposer
  │   ├─ +constructor parameter: videoComposer
  │   └─ +await videoComposer.compose() no buildWorkflow()
  │
  └── src/index.ts
      ├─ +import FFmpegVideoComposer
      ├─ +new FFmpegVideoComposer()
      └─ +injeção no PublicacaoService


╔════════════════════════════════════════════════════════════════════════════════╗
║                           REQUISITOS INSTALADOS                               ║
╚════════════════════════════════════════════════════════════════════════════════╝

✓ FFmpeg
  └─ sudo apt-get install ffmpeg
  └─ Utilizado para:
     ├─ Criação de placeholders de vídeo
     ├─ Sincronização de áudio + vídeo
     ├─ Geração de talking heads com texto
     └─ Concatenação de partes

✓ Node.js TypeScript
  └─ Já instalado no projeto


╔════════════════════════════════════════════════════════════════════════════════╗
║                          CONFIGURAÇÕES OPCIONAIS (.env)                       ║
╚════════════════════════════════════════════════════════════════════════════════╝

VIDEO_OUTPUT_WIDTH=1920          # Largura do vídeo final
VIDEO_OUTPUT_HEIGHT=1080         # Altura do vídeo final
VIDEO_BITRATE=5000k              # Bitrate do vídeo
AUDIO_BITRATE=128k               # Bitrate do áudio
VIDEO_CODEC=libx264              # Codec de vídeo (libx264, libx265, etc.)
AUDIO_CODEC=aac                  # Codec de áudio (aac, mp3, etc.)
VIDEO_PRESET=medium              # Velocidade FFmpeg (fast, medium, slow)
TALKING_HEAD_BG_COLOR=lightblue  # Cor de fundo para talking head
TALKING_HEAD_TEXT_COLOR=black    # Cor do texto para talking head
TALKING_HEAD_FONT_SIZE=48        # Tamanho da fonte para talking head


╔════════════════════════════════════════════════════════════════════════════════╗
║                            PRÓXIMAS IMPLEMENTAÇÕES                            ║
╚════════════════════════════════════════════════════════════════════════════════╝

✅ CURTO PRAZO:
  1. Testar com dados reais
  2. Criar endpoint para upload de B-roll
  3. Otimizar resolução por plataforma (16:9 vs 9:16)

⏳ MÉDIO PRAZO:
  4. Integrar avatar (D-ID, Synthesia)
  5. Adicionar lipsync (Wav2Lip)
  6. Customizar placeholders (logos, watermarks)

🔮 LONGO PRAZO:
  7. Cache de placeholders
  8. Integração com banco de vídeos de estoque
  9. Machine Learning para seleção automática de B-roll
```
