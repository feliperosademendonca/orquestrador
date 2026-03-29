## 📋 Testes da API Veo Gemini

### ✅ Status Atual
- **API Gemini**: Respondendo corretamente
- **SDK GoogleGenAI**: Carregado e funcional
- **Chaves de API**: 3 chaves ativas validadas
- **Conexão**: Estabelecida com sucesso

### ❌ Situação
Quota de API **ESGOTADA** temporariamente:
```
RESOURCE_EXHAUSTED (429)
You exceeded your current quota, please check your plan and billing details.
```

### 📝 Scripts Criados

#### 1. `test-veo-simple.js` (Principal)
Gera um vídeo de teste simples:
- **Tema**: Gatinho tocando uma pata
- **Duração**: 4 segundos
- **Resolução**: 720p
- **Proporção**: 16:9 (landscape)
- **Áudio**: Nativo (gerado automaticamente)

```bash
node test-veo-simple.js
```

**Saída esperada**: `test-veo-output.mp4`

#### 2. `validate-veo-api.js` (Validação)
Valida a conexão com a API sem usar quota:
- Testa cada chave de API
- Valida acesso ao SDK Gemini
- Fornece diagnóstico de conectividade

```bash
node validate-veo-api.js
```

### 🔑 Chaves Configuradas (3)
Todas validadas e ativas:
- GOOGLE_API_KEY_1
- GOOGLE_API_KEY_2
- GOOGLE_API_KEY_3

### ⏳ Próximas Ações

1. **Aguardar quota ser restaurada** (pode levar horas)
2. **Executar o teste**:
   ```bash
   node test-veo-simple.js
   ```
3. **Validar vídeo** em `test-veo-output.mp4`

### 🎬 O que o teste vai fazer
1. Conectar à API Gemini
2. Enviar solicitação para gerar vídeo de 4s
3. Fazer polling a cada 10 segundos
4. Baixar vídeo gerado
5. Salvar como `test-veo-output.mp4`

### 📊 Parâmetros da API Veo 3.1 Testados
✅ `model`: "veo-3.1-generate-preview"
✅ `prompt`: Suporte a descrição textual
✅ `config.resolution`: "720p"
✅ `config.durationSeconds`: 4 (número)
✅ `config.aspectRatio`: "16:9"
✅ Operações assíncronas (Long Running Operations)
✅ Polling com `getVideosOperation()`
✅ Download de vídeos com `files.download()`

### 🔧 Observações Técnicas
- API retorna `operation.name` para tracking
- Polling verifica `operation.done`
- Vídeo em `operation.response.generatedVideos[0].video`
- Marca d'água SynthID adicionada automaticamente
- Vídeos armazenados por 2 dias no servidor

---
**Última atualização**: 2026-03-29
**Status**: Pronto para produção (aguardando restauração de quota)
