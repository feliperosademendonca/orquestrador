# API Key Rotation - Guia de Configuração

## 🎯 Problema

Quando você tem múltiplas solicitações de vídeo, uma única API key Google pode atingir seu limite de quota rapidamente e retornar erro `429 RESOURCE_EXHAUSTED`.

## ✅ Solução

O sistema agora suporta **rotação automática de API keys**:

1. Configure múltiplas keys no `.env`
2. Quando uma chave atingir quota (erro 429), o sistema automaticamente rotaciona para a próxima
3. Se todas falharem, o sistema relata o erro final

## 📋 Configuração

### No arquivo `.env`:

```bash
# Múltiplas keys separadas por vírgula
GEMINI_API_KEYS="chave1,chave2,chave3"

# Ou uma única chave (fallback)
GOOGLE_API_KEY="chave1"
```

### Exemplo:
```bash
GEMINI_API_KEYS="AIzaSyBQBKi7TuR7P7QYVELN5S1ySwOm_qnxIUA,AIzaSyDifferentKey123456789,AIzaSyAnotherKey987654321"
```

## 🔄 Como Funciona

### Fluxo de Geração de Vídeo com Rotação:

```
POST /jobs
  ↓
OrquestradorPrincipal.process()
  ↓
FFmpegVideoComposer.composeVideo()
  ↓
VeoVideoAdapter.startVideoGeneration()
  ├─ Tenta com Key #1
  │  └─ Se erro 429 → rotaciona
  ├─ Tenta com Key #2
  │  └─ Se erro 429 → rotaciona
  └─ Tenta com Key #3
     └─ Se erro 429 → falha final
```

### Detalhes da Rotação:

1. **Durante a Geração Inicial** (`startVideoGeneration`):
   - Tenta com chave atual
   - Se erro 429, rotaciona para próxima chave
   - Aguarda delay exponencial antes de retry (1s → 2s → 4s)
   - Máximo de chaves = número de keys configuradas

2. **Durante a Consulta de Status** (`pollOperation`):
   - A cada 10 segundos, verifica status da operação
   - Se erro 429, rotaciona chave automaticamente
   - Continua polling com nova chave
   - Máximo 3 erros consecutivos antes de dar up

3. **Logging Detalhado**:
   ```
   [veo] Initialized with 3 API key(s)
   [veo] Using key #2 (usage: 1)
   [veo] Error with API key attempt 1: QUOTA_EXHAUSTED
   [veo] Rotating to next API key (attempt 2/3)
   [veo] Operation started: projects/.../operations/...
   ```

## 📊 Monitorar Uso de Keys

### Via Endpoint HTTP:

```bash
GET /veo-stats
```

Retorna:
```json
{
  "totalKeys": 3,
  "currentIndex": 1,
  "keys": [
    {
      "key": "AIzaSyBQBKi...",
      "usage": 5,
      "lastUsed": "2024-03-29T10:30:00Z"
    },
    {
      "key": "AIzaSyDifferent...",
      "usage": 8,
      "lastUsed": "2024-03-29T10:35:00Z"
    },
    {
      "key": "AIzaSyAnother...",
      "usage": 3,
      "lastUsed": "2024-03-29T10:25:00Z"
    }
  ]
}
```

## 🛡️ Estratégias de Quota

### Recomendação 1: Múltiplos Projetos Google
```
Projeto 1: AIzaSyBQBKi7TuR7P7QYVELN5S1ySwOm_qnxIUA
Projeto 2: AIzaSyDifferentKey123456789
Projeto 3: AIzaSyAnotherKey987654321
```

### Recomendação 2: Usar `.env.prod` vs `.env.dev`
```
# .env.dev (teste local)
GEMINI_API_KEYS="chave_dev_1,chave_dev_2"

# .env.prod (produção)
GEMINI_API_KEYS="chave_prod_1,chave_prod_2,chave_prod_3,chave_prod_4,chave_prod_5"
```

### Recomendação 3: Aumentar Quota Oficial
- Acesse [Google Cloud Console](https://console.cloud.google.com)
- Vá em APIs → Video Generation API
- Solicite aumento de quota
- Forneça caso de uso comercial

## 🧪 Teste Local

```bash
# Testar rotação de keys
npx ts-node test-api-key-rotation.ts

# Output esperado:
# ✅ Test completed!
# [api-rotator] Using key #1 (usage: 1)
# [api-rotator] Using key #2 (usage: 1)
# [api-rotator] Using key #0 (usage: 1)
```

## 🚀 Cenários de Uso

### Cenário 1: Pico de Tráfego
```
Hora 10:00 - 50 requisições de vídeo
├─ Key #1: 20 vídeos ✅
├─ Key #2: 20 vídeos ✅
└─ Key #3: 10 vídeos ✅
→ Total: 50 vídeos gerados sem erros!
```

### Cenário 2: Fallback Automático
```
POST /jobs
├─ Tenta Key #1 → erro 429 (esgotou)
├─ Tenta Key #2 → erro 429 (esgotou)
└─ Tenta Key #3 → ✅ sucesso!
→ Vídeo gerado normalmente
```

### Cenário 3: Todas Esgotadas
```
POST /jobs
├─ Tenta Key #1 → erro 429
├─ Tenta Key #2 → erro 429
└─ Tenta Key #3 → erro 429
→ Erro final: "Video generation failed after all API key attempts"
→ Sistema publica vídeo SEM video (graceful degradation)
```

## 📈 Métricas

Cada requisição logging detalhado:
```
[veo] Initialized with 3 API key(s)
[veo] Starting video generation (non-blocking)
[veo] Using key #2 (usage: 1)
[veo] Operation started: projects/video-gen-123/operations/op-456
[veo] Polling job-abc... (attempt 1/720)
[veo] Video generation completed for job-abc
```

## 🔧 Troubleshooting

### Problema: "No API keys provided"
**Solução**: Verificar `.env`:
```bash
# Verificar se GEMINI_API_KEYS está setado
echo $GEMINI_API_KEYS

# Se vazio, adicionar:
GEMINI_API_KEYS="sua-chave-aqui"
```

### Problema: Mesmo com múltiplas keys, ainda recebo 429
**Verificar**:
1. As keys são válidas e ativas?
   ```bash
   curl "https://generativelanguage.googleapis.com/v1/models:list?key=SEU_KEY"
   ```

2. O projeto associado tem quota?
   - Console → APIs → Video Generation → Quotas
   
3. Todas as keys são do mesmo projeto?
   - Cada projeto tem sua própria quota
   - Se forem do mesmo projeto, não ajuda

### Problema: Keys não estão sendo rotacionadas
**Debug**:
```bash
# Verificar logs do VEO adapter
curl http://localhost:3000/veo-stats

# Deve mostrar usage count aumentando em diferentes keys
```

## 💡 Best Practices

✅ **Fazer**:
- Usar keys de múltiplos projetos Google Cloud
- Monitorar uso via `/veo-stats`
- Solicitar aumento de quota para casos de uso comercial
- Testar rotação localmente antes de deploy

❌ **Não fazer**:
- Expor API keys em código/git
- Usar mesma key em múltiplos projetos diferentes
- Ignorar erros 429 como "normais"
- Adicionar keys expiradas ou desativadas

## 📚 Referências

- [Google Cloud Video Generation API](https://cloud.google.com/docs/generative-ai/video-generation)
- [Quotas & Limits](https://cloud.google.com/docs/quotas)
- [Authentication](https://cloud.google.com/docs/authentication)
