# VideoComposer - Composição de Vídeos

## Visão Geral

O `VideoComposer` é responsável por transformar os **áudios TTS** gerados e as **instruções visuais** do plano de roteiro em um **arquivo de vídeo MP4 completo** pronto para publicação.

## Fluxo de Funcionamento

```
1. Frontend envia requisição (título, ideia, plataformas)
                    ↓
2. Gemini gera plano com partes (roteiro estruturado)
                    ↓
3. Google TTS gera áudios MP3 para cada parte
                    ↓
4. FFmpegVideoComposer combina:
   - Áudios TTS (part-1.mp3, part-2.mp3, etc.)
   - Vídeos B-roll (se fornecidos pelo frontend)
   - Imagens/textos para talking heads
                    ↓
5. Resultado: /tmp/{jobId}/final-output.mp4
                    ↓
6. Adaptadores (YouTube, TikTok) recebem o MP4 final
```

## Como Funciona

### Estrutura do Plano (`RoteiroPlan`)

```typescript
{
  "plan": {
    "summary": "...",
    "language": "pt-BR",
    "totalParts": 5,
    "partDurationSec": 5,
    "parts": [
      {
        "id": 1,
        "ttsText": "...",
        "visualType": "talking_head|broll",  // Tipo de visual
        "visualDirection": "...",             // Descrição do visual esperado
        "brollTags": ["tag1", "tag2"]         // Tags para buscar vídeo de estoque
      }
    ]
  },
  "assets": [
    {
      "partId": 1,
      "ttsAudioPath": "tmp/{jobId}/part-1.mp3"  // Áudio gerado pelo Google TTS
    }
  ]
}
```

### Tipos de Visuais

#### 1. **talking_head** (Apresentadora/Avatar)
- Tipo: Apresentação direta para câmera
- O que acontece:
  - Se o frontend enviar um vídeo da apresentadora → usa esse vídeo
  - Se não enviar → cria um placeholder com fundo colorido + texto
  
#### 2. **broll** (Conteúdo de suporte)
- Tipo: Vídeos que complementam o áudio (close-up de produtos, demonstrações, etc.)
- Procura:
  1. Vídeo fornecido pelo frontend no formato `part-{id}.mp4`
  2. Se não encontrar → cria um placeholder preto
  
### Processo de Composição

1. **Preparar Assets:**
   - Para cada parte do plano:
     - Localizar o áudio TTS (obrigatório)
     - Localizar o vídeo visual (se disponível)
     - Criar placeholder se necessário

2. **Sincronizar Áudio + Vídeo:**
   - Usar FFmpeg para combinar vídeo + áudio
   - Resultado: `synced-part-{id}.mp4`

3. **Concatenar Partes:**
   - Criar arquivo `concat.txt` com lista de partes
   - Usar FFmpeg concat demux para juntar tudo
   - Resultado: `/tmp/{jobId}/final-output.mp4`

## Requisitos

### FFmpeg
O sistema usa **FFmpeg** para processamento de vídeo. Certifique-se de que está instalado:

```bash
# Linux (Ubuntu/Debian)
apt-get install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Baixe de https://ffmpeg.org/download.html
```

Verifique a instalação:
```bash
ffmpeg -version
```

## Estrutura de Diretórios

```
tmp/
  {jobId}/
    part-1.mp3           # Áudios TTS (gerados)
    part-2.mp3
    part-3.mp3
    part-4.mp3
    part-5.mp3
    
    synced-part-1.mp4    # Vídeos sincronizados (gerados pelo VideoComposer)
    synced-part-2.mp4
    synced-part-3.mp4
    synced-part-4.mp4
    synced-part-5.mp4
    
    final-output.mp4     # Vídeo final (pronto para publicação)
    concat.txt          # Arquivo de instrução FFmpeg
```

## Enviando B-roll do Frontend

Para que o `VideoComposer` use seus próprios vídeos de B-roll em vez de placeholders, o frontend deve enviar os arquivos de vídeo:

1. **Nomeação:** `part-{id}.mp4` (ex: `part-2.mp4`, `part-3.mp4`)
2. **Formato:** MP4, H.264 recomendado
3. **Localização:** Dentro da pasta `/tmp/{jobId}/`

Você pode fazer upload via um endpoint HTTP adicional ou enviando em multipart na requisição inicial.

## Placeholders Padrão

Se nenhum vídeo for fornecido:

- **talking_head:** Fundo azul claro + texto descritivo em preto
- **broll:** Fundo preto (sem conteúdo)

Esses placeholders garantem que um vídeo válido seja gerado mesmo sem assets externos.

## Exemplo de Uso (Interno)

```typescript
const videoComposer = new FFmpegVideoComposer();

const finalVideoPath = await videoComposer.compose(
  jobId,           // "abc123"
  plan,            // RoteiroPlan com 5 partes
  assets,          // WorkflowAsset[] com caminhos dos áudios
  outputDir        // "/workspaces/orquestrador/tmp/abc123"
);

// Resultado: "/workspaces/orquestrador/tmp/abc123/final-output.mp4"
```

## Configuração

Adicione ao seu `.env` se quiser customizar (opcional):

```env
# Já usa valores padrão - customize se necessário
VIDEO_OUTPUT_WIDTH=1920
VIDEO_OUTPUT_HEIGHT=1080
VIDEO_BITRATE=5000k
AUDIO_BITRATE=128k
```

## Logs

O `VideoComposer` gera logs detalhados:

```
[video-composer] Starting composition for job abc123
[video-composer] Creating placeholder video for part 1
[video-composer] Creating talking head video for part 1
[video-composer] Syncing audio for part 1
[video-composer] Creating concat demux file
[video-composer] Concatenating videos
[video-composer] Video composition completed /tmp/abc123/final-output.mp4
```

## Tratamento de Erros

Se algo falhar durante a composição:
- ❌ Erro no FFmpeg → Exception é capturada e logada
- ⚠️ B-roll não encontrado → Usa placeholder preto
- ⚠️ Áudio não encontrado → Error ("Missing audio for part X")

O fluxo continua mesmo com erros parciais, garantindo que sempre há um vídeo gerado.

## Próximos Passos

1. **Implementar upload de B-roll:** Criar endpoint para frontend enviar vídeos
2. **Customizar avatares:** Integrar geração de avatar (ex: D-ID, Synthesia)
3. **Sincronizar lábios:** Integrar lipsync para matching de voz+movimento
4. **Qualidade:** Tunar codecs, bitrates e resoluções conforme necessário
5. **Cache:** Armazenar placeholders gerados para reutilização
