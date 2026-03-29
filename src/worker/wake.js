require("dotenv").config();

const WORKER_PORT = Number(process.env.WORKER_PORT || process.env.PORT || 3100);
const endpoint = process.env.COLAB_WAKE_ENDPOINT || `http://localhost:${WORKER_PORT}/wake`;

async function main() {
  console.log(`[wake] chamando ${endpoint}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ source: "npm-run-colab:wake" }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("[wake] falha ao acordar colab", data);
    process.exit(1);
  }

  console.log("[wake] colab pronto", JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error("[wake] erro inesperado", error);
  process.exit(1);
});
