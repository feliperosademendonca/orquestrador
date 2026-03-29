# Resolver Bloqueio de IP - Google Veo API

## 🔴 Problema

Você recebeu **429 RESOURCE_EXHAUSTED** em **todas as 4 API keys de contas diferentes**. Isso indica que o problema não é quota das keys, mas sim **IP bloqueado** pela Google.

## ✅ Solução: VPN ou Proxy

### Opção 1: WireGuard (Recomendado - mais rápido)

```bash
# Instalar WireGuard
sudo apt update && sudo apt install wireguard wireguard-tools

# Baixar configuração do seu provedor VPN
# (Exemplo usando Mullvad VPN - livre)

# Se usar Mullvad:
curl https://mullvad.net/en/download/wireguard-keys/ -o wireguard.conf

# Ou gerar chaves manualmente:
umask 077
wg genkey | tee privatekey | wg pubkey > publickey

# Ativar VPN
sudo wg-quick up ./wg0.conf

# Verificar
ip addr
curl ifconfig.me  # Deve mostrar outro IP
```

### Opção 2: ProtonVPN (gratuito com limites)

```bash
# Instalar ProtonVPN CLI
sudo apt install -y python3-pip
pip3 install protonvpn-cli-ng

# Fazer login
protonvpn configure

# Conectar
protonvpn connect

# Verificar IP mudou
curl ifconfig.me
```

### Opção 3: OpenVPN

```bash
# Instalar
sudo apt install openvpn

# Baixar arquivo .ovpn do seu provedor
# Conectar
sudo openvpn --config seu-arquivo.ovpn
```

### Opção 4: Proxy HTTP (melhor para APIs)

Se quiser usar um **proxy residencial** (IP rotativo automático):

```bash
# Adicionar ao .env
HTTP_PROXY="http://proxy.service.com:port"
HTTPS_PROXY="http://proxy.service.com:port"

# Exportar no terminal
export HTTP_PROXY="http://proxy.service.com:port"
export HTTPS_PROXY="http://proxy.service.com:port"

# Depois rodar
npm run dev
```

**Provedores recomendados:**
- Bright Data (antes Luminati) - $50+ crédito inicial
- Oxylabs - Free trial disponível
- ScraperAPI - $5 trial
- Smartproxy - Barato, bom para APIs

## 🚀 Testar se IP foi bloqueado

```bash
# Verificar seu IP atual
curl ifconfig.me

# Testar requisição para Google
curl -H "Authorization: Bearer $GOOGLE_API_KEY" \
  "https://generativelanguage.googleapis.com/v1/models:list"

# Se retornar 403 Forbidden sem erro de API, é bloqueio de IP
# Se retornar 429, é quota da key
```

## 🔄 Retry Logic Implementado

Agora o sistema:

1. **Tenta com backoff exponencial**: 1s → 2s → 4s → 8s → 16s → 32s → 64s → 128s → 256s → 512s
2. **Rotaciona entre 4 API keys** a cada tentativa
3. **Total de 10 ciclos de retry** (10 global attempts × 4 keys = até 40 tentativas)
4. **Se falhar após todos os retries com erro 429**: Re-queue o job na fila com status `queued_for_retry`
5. **Se falhar após retries**: Job é marcado como **FAILED** - não publica nada
6. **Retorna erro específico**: `VIDEO_COMPOSITION_FAILED: [motivo]`

### Fluxo de Retry:

```
[Tentativa 1] Tenta com key #1
  └─ Falha com 429
    └─ [Tentativa 2] Tenta com key #2 (backoff 1s)
      └─ Falha com 429
        └─ [Tentativa 3] Tenta com key #3 (backoff 2s)
          └─ Falha com 429
            └─ [Tentativa 4] Tenta com key #4 (backoff 4s)
              └─ Falha com 429
                └─ [Tentativa 5] Volta para key #1 (backoff 8s)
                  └─ ... continua até 10 ciclos completos
```

## 🧪 Testar VPN + Retry

```bash
# 1. Ativar VPN
sudo wg-quick up ./wg0.conf  # ou seu comando VPN

# 2. Confirmar IP mudou
curl ifconfig.me

# 3. Rodar servidor
npm run dev

# 4. Enviar requisição
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user1",
    "idea": "Um vídeo sobre IA",
    "platforms": ["youtube", "tiktok"]
  }'

# 5. Monitorar logs
# Deve ver:
# [veo] Retry attempt 1/10, aguardando ...
# [veo] Starting video generation (non-blocking)
# [veo] Operation started: projects/...
```

## 📊 Monitorar Estatísticas de Keys

```bash
curl http://localhost:3000/veo-stats
```

Retorna:
```json
{
  "totalKeys": 4,
  "currentIndex": 2,
  "keys": [
    {
      "key": "AIzaSyDKxDvNbmZm...",
      "usage": 5,
      "lastUsed": "2024-03-29T10:30:00Z"
    },
    ...
  ]
}
```

## 🔐 Usando com Docker + VPN

Se rodar em Docker:

```dockerfile
# Dockerfile
FROM node:18-alpine
RUN apk add --no-cache wireguard-tools openresolv

COPY wg0.conf /etc/wireguard/
COPY entrypoint.sh /

RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

```bash
# entrypoint.sh
#!/bin/sh
wg-quick up wg0
npm run dev
```

## ⚠️ Importante

- **Não use VPN para ocultar uso legítimo**: Google sabe que VPNs são usadas, não é banição automática
- **Respeite limites de API**: Mesmo com VPN + rotação, não bombardeie a API
- **Monitore uso**: Verifique `/veo-stats` regularmente
- **Considere aumentar quota**: Google oferece Free Tier generoso se usar corretamente

## 🆘 Se mesmo com VPN não funcionar

1. Contate Google Cloud Support
2. Solicite revisão de bloqueio (geralmente 24-48h)
3. Considere usar **Google Cloud Tasks** para rate limiting
4. Use **Batch Processing API** para processar em lotes (melhor quota)

## Links Úteis

- [Google Veo API Quotas](https://cloud.google.com/docs/quotas)
- [WireGuard Documentation](https://www.wireguard.com/)
- [ProtonVPN CLI](https://github.com/protonvpn/protonvpn-cli-ng)
- [Rate Limiting Best Practices](https://ai.google.dev/gemini-api/docs/rate-limits)
