#!/usr/bin/env bash

# Script de teste para VideoComposer
# Simula um fluxo completo gerando um vídeo de teste

set -e

echo "✓ VideoComposer Test Script"
echo ""

# 1. Verificar FFmpeg
echo "1. Verificando FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
  echo "❌ FFmpeg não está instalado"
  echo "Instale com: apt-get install ffmpeg"
  exit 1
fi
echo "✓ FFmpeg instalado: $(ffmpeg -version | head -1)"
echo ""

# 2. Criar diretório de teste
TEST_DIR="/tmp/video-composer-test"
mkdir -p "$TEST_DIR"
echo "✓ Diretório de teste criado: $TEST_DIR"
echo ""

# 3. Gerar áudio de teste (usando FFmpeg)
echo "2. Gerando áudios TTS de teste..."
for i in {1..3}; do
  echo "  Gerando part-$i.mp3..."
  ffmpeg -f lavfi -i "sine=frequency=440:duration=3" \
    -b:a 128k "$TEST_DIR/part-$i.mp3" -y 2>/dev/null
done
echo "✓ Áudios gerados"
echo ""

# 4. Demonstrar o que o VideoComposer fará
echo "3. O que o VideoComposer fará:"
echo ""
echo "├─ Para cada parte do roteiro:"
echo "│  ├─ Procurar vídeo B-roll (part-{id}.mp4)"
echo "│  ├─ Se não encontrar, criar placeholder (preto ou com texto)"
echo "│  └─ Sincronizar com áudio TTS"
echo "│"
echo "├─ Criar arquivo concat.txt com lista de partes"
echo "│"
echo "└─ Gerar final-output.mp4 via FFmpeg concat demux"
echo ""

# 5. Simular concatenação
echo "4. Simulando processamento FFmpeg..."
echo ""

# Criar vídeos placeholders para teste
echo "   Criando placeholder de vídeo..."
ffmpeg -f lavfi -i "color=c=black:s=1920x1080:d=3" -pix_fmt yuv420p \
  "$TEST_DIR/placeholder-1.mp4" -y 2>/dev/null

echo "   Sincronizando áudio com vídeo..."
ffmpeg -i "$TEST_DIR/placeholder-1.mp4" -i "$TEST_DIR/part-1.mp3" \
  -c:v libx264 -preset medium -c:a aac -shortest \
  "$TEST_DIR/synced-part-1.mp4" -y 2>/dev/null

echo "   Concatenando vídeos..."
echo "file '$TEST_DIR/synced-part-1.mp4'" > "$TEST_DIR/concat.txt"
ffmpeg -f concat -safe 0 -i "$TEST_DIR/concat.txt" \
  -c copy "$TEST_DIR/final-output.mp4" -y 2>/dev/null

echo "✓ Processamento FFmpeg simulado com sucesso"
echo ""

# 6. Mostrar resultado
echo "5. Resultado:"
echo ""
ls -lh "$TEST_DIR/"
echo ""
echo "✓ Teste completado com sucesso!"
echo ""
echo "Arquivos gerados em: $TEST_DIR/"
echo "Vídeo final: $TEST_DIR/final-output.mp4"
echo ""
echo "Próximos passos:"
echo "  1. VideoComposer lerá automaticamente os áudios de /tmp/{jobId}/"
echo "  2. Criará placeholders se B-roll não for fornecido"
echo "  3. Sincronizará áudio + vídeo"
echo "  4. Gerará final-output.mp4"
echo "  5. Adaptadores de plataforma receberão o MP4 pronto"
