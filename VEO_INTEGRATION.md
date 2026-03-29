# Integração Veo 3.1 - Google Gemini Video

## Overview

O `VeoVideoAdapter` agora usa a API correta do Google Gemini Video (Veo 3.1) via SDK `@google/genai` para gerar vídeos profissionais com sincronização de lábios automática.

## Fluxo Implementado

```
1. PublicacaoService gera áudios com GoogleTtsAdapter
2. FFmpegVideoComposer concatena os áudios e converte para base64
3. FFmpegVideoComposer instancia VeoVideoAdapter
4. VeoVideoAdapter chama Veo 3.1 API
5. Veo gera vídeo com lipsync sincronizado ao áudio
6. FFmpegVideoComposer salva vídeo final
7. PublicacaoService publica em redes sociais
```

## Configuração Necessária

### Variáveis de Ambiente

```bash
# Em .env
GOOGLE_API_KEY=AIzaSyBQBKi7TuR7P7QYVELN5S1ySwOm_qnxIUA  # Sua chave Gemini/Google
```

Se `GOOGLE_API_KEY` não estiver definida, o sistema usará a primeira chave de `GEMINI_API_KEYS`.

### Permissões GCP

Certifique-se que sua chave de API tem acesso a:
- `generativelanguage.googleapis.com` (Gemini Video API)
- Modelos Veo 3.1 habilitados no seu projeto

## Como Funciona

### 1. Geração de Vídeo

```typescript
const veo = new VeoVideoAdapter();

const videoBase64 = await veo.generateVideoFromAudio(
  audioBase64,          // Áudio em base64 (MP3)
  avatarImageBase64,    // Imagem do avatar em base64 (JPEG/PNG)
  "Prompt descritivo"   // Instrução para o Veo
);
```

### 2. Processo Interno

1. **Salva temporários**: Converte base64 em arquivos temporários
2. **Chama Veo**: Inicia geração de vídeo com `generateVideos()`
3. **Polling**: Aguarda conclusão (max 20 minutos com check a cada 10s)
4. **Download**: Baixa o vídeo gerado como arquivo
5. **Converte**: Converte arquivo em base64
6. **Limpa**: Remove arquivos temporários

### 3. Integração com FFmpegVideoComposer

```typescript
const composer = new FFmpegVideoComposer();

// Automatically uses VeoVideoAdapter internally
const finalVideo = await composer.compose(
  jobId,
  plan,
  assets,  // Com ttsAudioPath preenchidos
  videoInputDir  // Com avatar.jpg/png
);
```

## Melhorias em Relação ao Anterior

| Aspecto | Antes | Agora |
|--------|-------|-------|
| SDK | `@google-cloud/aiplatform` (complexo) | `@google/genai` (simples) |
| Modelo | `veo-001` (desatualizado) | `veo-3.1-generate-preview` (atual) |
| Lipsync | Manual/FFmpeg | Automático (Veo) |
| Qualidade | Baixa | Profissional |
| Implementação | Tipos complexos | Tipos simples e diretos |

## Limites Conhecidos

- Tempo máximo de polling: 20 minutos
- Tamanho máximo de arquivo: Dependente do Veo 3.1
- Sem suporte a vídeos de entrada (apenas imagem estática)
- Requer chave de API Google com acesso a Gemini Video

## Testando

```bash
# Compilar
npm run build

# Testar geração de vídeo
npx ts-node test-veo.ts
```

O script de teste criará um arquivo `/tmp/test-veo-output.mp4` com o vídeo gerado.

## Próximos Passos

1. Testar com áudio e imagem reais
2. Integrar melhor tratamento de erros e retry
3. Adicionar fallback para método anterior se Veo falhar
4. Otimizar para diferentes resoluções (16:9, 9:16, etc)
5. Adicionar métricas e logging detalhado
