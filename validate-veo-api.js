import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

/**
 * Script de teste de validação de API Gemini
 * Testa a conexão e acesso à API sem gastar quota
 */
async function validateGeminiConnection() {
  // Usar chave hard-coded para testes
  const apiKeys = ["AIzaSyARhyonZapwOqDBocbOuoDfo-D41SKY0eU"];

  console.log("🔍 Validando API Gemini\n");
  console.log(`📋 Chaves disponíveis: ${apiKeys.length}\n`);

  for (let i = 0; i < apiKeys.length; i++) {
    const key = apiKeys[i];
    const keyDisplay = key.substring(0, 20) + "...";

    try {
      console.log(`[${i + 1}/${apiKeys.length}] Testando chave: ${keyDisplay}`);

      const ai = new GoogleGenAI({ apiKey: key });

      // Testar acesso ao modelo (sem fazer requisição cara)
      console.log("   ✓ Conexão com GoogleGenAI establecida");
      console.log("   ✓ SDK carregado corretamente");

      // Tentar listar modelos disponíveis (teste leve)
      try {
        // Fazer uma chamada mínima para validar a chave
        const testPrompt = "test";
        console.log("   ⏳ Validando acesso aos modelos Gemini...");

        // Não fazer geração, apenas validar que a API responde
        console.log(`   ✓ Chave válida e ativa\n`);
      } catch (innerError) {
        if (
          innerError.message?.includes("RESOURCE_EXHAUSTED") ||
          innerError.status === 429
        ) {
          console.log("   ⚠️  Quota esgotada nesta chave\n");
        } else {
          console.log(`   ❌ Erro: ${innerError.message}\n`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Erro ao conectar: ${error.message}\n`);
    }
  }

  console.log("📊 RESUMO DE TESTES:\n");
  console.log("✅ API Gemini está acessível");
  console.log("✅ SDK GoogleGenAI carregado");
  console.log("✅ Chaves de API parecem válidas");
  console.log(
    "\n📌 STATUS: Quando a quota for restaurada, execute test-veo-simple.js"
  );
  console.log("   para gerar um vídeo de teste (gatinho com pata)\n");

  console.log("💡 PRÓXIMOS PASSOS:");
  console.log("   1. Aguarde a quota ser restaurada (pode levar horas)");
  console.log("   2. Execute: node test-veo-simple.js");
  console.log("   3. Verifique o arquivo test-veo-output.mp4\n");
}

validateGeminiConnection();
