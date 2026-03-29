import { GoogleGenAI } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Script de teste simples para API Veo 3.1
 * Gera um vídeo curto (4s, 720p) para validar conexão
 */
async function testVeoApi() {
  // Chave de API hard-coded para testes
  const apiKey = "AIzaSyBj_OqwgZczxm4c4mDlu1PQ8C-gtjrFtfA";

  console.log("🎬 Iniciando teste de geração de vídeo com Veo 3.1...\n");

  const ai = new GoogleGenAI({ apiKey });

  // Prompt simples e rápido
  const prompt =
    "A cute ginger kitten playing with a red ball, touching it with its paw, soft warm lighting, close-up shot";

  try {
    // 1. Iniciar geração
    console.log("📤 Enviando solicitação para API Gemini...");
    console.log(`   Prompt: "${prompt}"`);
    console.log("   Config: 720p, 4 segundos, landscape\n");

    let operation = await ai.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt: prompt,
      config: {
        resolution: "720p",
        durationSeconds: 4, // Número, não string
        aspectRatio: "16:9",
      },
    });

    console.log(`✅ Operação iniciada: ${operation.name}\n`);

    // 2. Polling até conclusão
    let attempts = 0;
    const maxAttempts = 180; // 30 minutos (10s x 180)

    while (!operation.done && attempts < maxAttempts) {
      attempts++;
      console.log(
        `⏳ Aguardando... (tentativa ${attempts}/${maxAttempts}, ${(attempts * 10) / 60} min)`
      );

      await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 segundos

      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (!operation.done) {
      console.error("❌ Timeout: vídeo não foi gerado em 30 minutos");
      process.exit(1);
    }

    // 3. Validar resposta
    console.log("\n✅ Vídeo gerado com sucesso!\n");

    const response = operation.response;
    const generatedVideos = response?.generatedVideos;

    if (!generatedVideos || generatedVideos.length === 0) {
      console.error("❌ Erro: Nenhum vídeo retornado pela API");
      process.exit(1);
    }

    const videoFile = generatedVideos[0].video;
    if (!videoFile) {
      console.error("❌ Erro: Propriedade 'video' não encontrada na resposta");
      process.exit(1);
    }

    // 4. Download
    const outputPath = path.join(__dirname, "test-veo-output.mp4");

    console.log(`📥 Baixando vídeo para: ${outputPath}`);

    await ai.files.download({
      file: videoFile,
      downloadPath: outputPath,
    });

    console.log("\n✅ ✅ ✅ TESTE CONCLUÍDO COM SUCESSO!\n");
    console.log("📊 Detalhes:");
    console.log(`   - Arquivo: test-veo-output.mp4`);
    console.log(`   - Duração: 4 segundos`);
    console.log(`   - Resolução: 720p`);
    console.log(`   - Proporção: 16:9`);
    console.log(`   - Áudio: Nativo (gerado automaticamente)`);
    console.log(`   - Marca d'água: SynthID (padrão)`);
    console.log("\n⏱️  Total de tempo: ~" + Math.round(attempts * 10 / 60) + " minutos\n");

  } catch (error) {
    console.error("\n❌ Erro na geração:");
    console.error(`   ${error.message}\n`);

    if (error.status === 429) {
      console.error(
        "   → Quota de API esgotada. Aguarde e tente novamente."
      );
    } else if (error.status === 403) {
      console.error(
        "   → Permissão negada. Verifique sua chave de API."
      );
    } else if (error.message?.includes("RESOURCE_EXHAUSTED")) {
      console.error("   → Recursos esgotados. Tente novamente mais tarde.");
    }

    process.exit(1);
  }
}

// Executar
testVeoApi();
