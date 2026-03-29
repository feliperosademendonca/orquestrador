import { VeoVideoAdapter } from "./src/infrastructure/external/VeoVideoAdapter";
import { promises as fs } from "fs";

async function testVeo() {
  const veo = new VeoVideoAdapter();

  // Criar um prompt simples para teste
  const prompt = `A close up of a person speaking, confident and engaging, explaining a concept clearly. 
The person is professional, maintains good eye contact, and gestures naturally.`;

  // Criar áudio dummy (seria gerado pelo TTS normalmente)
  // Para teste, vamos criar um buffer mínimo
  const dummyAudio = Buffer.alloc(1000); // 1KB de dados dummy
  const audioBase64 = dummyAudio.toString("base64");

  // Criar imagem dummy (seria o avatar normalmente)
  const dummyImage = Buffer.alloc(1000);
  const imageBase64 = dummyImage.toString("base64");

  console.log("[test] Starting Veo video generation test");
  console.log("[test] Prompt:", prompt);

  try {
    const videoBase64 = await veo.generateVideoFromAudio(
      audioBase64,
      imageBase64,
      prompt
    );

    console.log("[test] Video generated successfully!");
    console.log("[test] Video size:", videoBase64.length, "characters");

    // Salvar para inspeção
    const buffer = Buffer.from(videoBase64, "base64");
    await fs.writeFile("/tmp/test-veo-output.mp4", buffer);
    console.log("[test] Video saved to /tmp/test-veo-output.mp4");
  } catch (error) {
    console.error("[test] Error:", error);
    process.exit(1);
  }
}

testVeo();
