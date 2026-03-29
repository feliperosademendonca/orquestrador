# Arquitetura Event-Driven - Veo Video Generation

## Problema Anterior ❌

**Bloqueio síncrono:**
```
Cliente → POST /jobs → Aguarda 2-3 horas → Resposta
```

- Cliente travado esperando vídeo (timeout HTTP)
- Servidor não consegue processar outras requisições
- Má experiência de usuário

## Solução Implementada ✅

**Event-driven com webhooks:**
```
Cliente → POST /jobs (retorna jobId em 100ms)
                  ↓
         [Polling em Background]
                  ↓
         Vídeo pronto? → webhook/callback → Cliente notificado
```

## Fluxo Completo

### 1. Cliente Inicia Requisição

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "title": "Meu Vídeo",
    "idea": "...",
    "videoUrl": "...",
    "platforms": ["youtube"],
    "avatarImageBase64": "...",
    "avatarImageMimeType": "image/png",
    "callbackUrl": "https://meu-app.com/webhooks/video-ready"  // NOVO!
  }'
```

### 2. Resposta Imediata

```json
{
  "requestId": "abc-123-def"
}
```

**Status: 202 Accepted** (processando em background)

### 3. Polling Acontece em Background

```typescript
[veo] Starting video generation (non-blocking)
[veo] Operation started: projects/123/locations/us-central1/operations/123456
[veo] Polling abc-123-def... (attempt 1/720)
...
[veo] Polling abc-123-def... (attempt 15/720)
[veo] Video generation completed for abc-123-def
[veo] Downloading video for abc-123-def to: tmp/abc-123-def/veo-output.mp4
```

### 4. Webhook Notification

Quando o vídeo estiver pronto, Orquestrador chama:

```bash
POST https://meu-app.com/webhooks/video-ready
Content-Type: application/json

{
  "jobId": "abc-123-def",
  "videoPath": "/workspaces/orquestrador/tmp/abc-123-def/veo-output.mp4",
  "videoBase64": "AAAAB3NzaC1yc2...",  // Vídeo em base64
  "status": "completed"
}
```

## APIs Disponíveis

### 1. Iniciar Geração (Non-blocking)

```typescript
const veo = new VeoVideoAdapter();

const jobId = await veo.startVideoGeneration({
  prompt: "...",
  audioBase64: "...",
  avatarImageBase64: "...",
  jobId: "meu-job-123",
  callbackUrl: "https://meu-app.com/webhook"  // Opcional
});

console.log("Started:", jobId);  // Retorna imediatamente
```

### 2. Escutar Eventos

```typescript
veo.on("video-ready", (result) => {
  console.log("Vídeo pronto!", result.videoPath);
});

veo.on("error", (error) => {
  console.error("Erro na geração:", error.jobId, error.error);
});
```

### 3. Verificar Status

```typescript
const status = veo.getOperationStatus(jobId);

console.log(status);
// {
//   jobId: "abc-123-def",
//   status: "processing",
//   operationId: "projects/123/locations/...",
//   elapsedSeconds: 45,
//   isDone: false
// }
```

### 4. Cancelar Operação

```typescript
const cancelled = await veo.cancelOperation(jobId);

if (cancelled) {
  console.log("Operação cancelada!");
}
```

### 5. LEGACY: Modo Síncrono (compatibilidade)

```typescript
// Ainda funciona, mas bloqueia
const result = await veo.generateVideoFromAudio(
  audioBase64,
  avatarImageBase64,
  prompt
);
```

## Onde o Vídeo é Salvo?

**Path Padrão:**
```
/workspaces/orquestrador/tmp/{jobId}/veo-output.mp4
```

**Configurável via:**
```typescript
// src/config/index.ts
workflowOutputDir: process.env.WORKFLOW_OUTPUT_DIR ?? "tmp"
```

## Integrações Necessárias

### Adicionar Webhook Endpoint na API

```typescript
// src/infrastructure/http/ApiServer.ts

app.post("/webhooks/veo-ready", async (req, res) => {
  const { jobId, videoPath, videoBase64, status } = req.body;
  
  console.log(`[webhook] Video ready for job ${jobId}`);
  
  // Salvar vídeo em S3, banco de dados, etc
  // Notificar usuário
  // Prosseguir com publicação
  
  res.status(200).json({ received: true });
});
```

### Instanciar Veo com Listeners

```typescript
// src/index.ts

const veo = new VeoVideoAdapter();

veo.on("video-ready", async (result) => {
  console.log("[app] Vídeo gerado:", result.jobId);
  // Processar vídeo
  // Publicar em redes
  // Notificar usuário
});

veo.on("error", (error) => {
  console.error("[app] Erro Veo:", error);
  // Registrar erro
  // Notificar usuário
  // Retry lógica
});
```

## Fluxo Completo do Job

```
1. POST /jobs
   ├─ Gemini: Gera roteiro (síncrono)
   ├─ TTS: Gera áudios (síncrono)
   ├─ FFmpeg: Concatena áudios (síncrono)
   └─ Veo.startVideoGeneration() ← ASYNC, retorna jobId
       ├─ Polling em background
       └─ ao completar → emit("video-ready")

2. Cliente obtém requestId em 100ms
   └─ Continua com vida própria

3. Quando Veo terminar (~30 min a 2 horas)
   ├─ Emite evento "video-ready"
   ├─ Envia webhook se callbackUrl fornecida
   └─ Próximo passo: publicação
```

## Timeout Configurável

```typescript
// VeoVideoAdapter.ts - linha 73
const maxAttempts = 720; // 2 horas com polling a cada 10s

// Customizável:
const maxAttempts = 360; // 1 hora
const maxAttempts = 1440; // 4 horas
```

## Diagrama de Fluxo

```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │
       │ POST /jobs + callbackUrl
       ▼
┌──────────────────────┐
│  PublicacaoService   │
├──────────────────────┤
│ 1. Gemini (sync)     │
│ 2. TTS (sync)        │
│ 3. FFmpeg (sync)     │
│ 4. Veo.start() ◄─────┼─── Retorna jobId
│    (async)           │    + status 202
└──────────────────────┘
       │
       │ jobId
       │
       ▼
┌──────────────────────┐
│  VeoVideoAdapter     │
├──────────────────────┤
│ polling em bgnd      │
│ (não bloqueia)       │
│                      │
│ Cada 10 segundos:    │
│ - getVideosOperation │
│ - operação.done?     │
│   └─ SIM → download  │
│      └─ EMIT event   │
│      └─ Webhook      │
└──────────────────────┘
       │
       │ video-ready event
       │
       ▼
┌──────────────────────┐
│    Cliente Webhook   │
├──────────────────────┤
│ POST callback URL    │
│ (videoBase64, path)  │
└──────────────────────┘
```

## Benefícios

✅ **Não bloqueia requisições HTTP**  
✅ **Cliente recebe resposta em ~100ms**  
✅ **Servidor pode processar outros jobs**  
✅ **Escalável para múltiplas gerações simultâneas**  
✅ **Event-driven = reativo e responsivo**  
✅ **Suporta callbacks/webhooks**  
✅ **Status tracking em tempo real**  
✅ **Cancelamento de operações**  

## Compatibilidade

- ✅ `generateTalkingHead()` ainda funciona (modo legacy síncrono)
- ✅ `generateVideoFromAudio()` ainda funciona
- ✅ FFmpegVideoComposer.compose() aguarda normalmente
- ⚠️ Quando quota Veo esgotada, sistema continua sem vídeo (graceful fallback)
