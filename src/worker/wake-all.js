const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const WORKER_PORT = Number(process.env.WORKER_PORT || process.env.PORT || 3100);
const endpoint = process.env.COLAB_WAKE_ENDPOINT || `http://localhost:${WORKER_PORT}/wake`;

function loadUrls() {
  const urls = [];

  if (process.env.COLAB_URL) urls.push(process.env.COLAB_URL.trim());
  if (process.env.COLAB_URL_2) urls.push(process.env.COLAB_URL_2.trim());
  if (process.env.COLAB_URL_3) urls.push(process.env.COLAB_URL_3.trim());

  const bulk = (process.env.COLAB_URLS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  urls.push(...bulk);

  // Deduplicar preservando ordem
  return [...new Set(urls)];
}

async function wakeOne(url, index, total) {
  console.log(`[wake-all] (${index + 1}/${total}) acordando: ${url}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, source: "npm-run-colab:wake:all" }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.details || data?.error || `Falha HTTP ${response.status}`);
  }

  console.log(`[wake-all] (${index + 1}/${total}) ok`);
  return data;
}

async function main() {
  const urls = loadUrls();
  if (urls.length === 0) {
    throw new Error("Nenhuma URL de Colab configurada. Defina COLAB_URL/COLAB_URLS no .env");
  }

  const results = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const result = await wakeOne(urls[i], i, urls.length);
      results.push({ url: urls[i], ok: true, result });
    } catch (error) {
      results.push({ url: urls[i], ok: false, error: error?.message || String(error) });
      console.error(`[wake-all] (${i + 1}/${urls.length}) falhou:`, error?.message || error);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`[wake-all] concluido: ${results.length - failed.length}/${results.length} notebooks acordados`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[wake-all] erro inesperado:", error);
  process.exit(1);
});
