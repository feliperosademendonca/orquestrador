const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const express = require("express");
const { getColabStatus, getColabStatusForUrl, closeBrowser } = require("./colab");

const app = express();
const port = Number(process.env.WORKER_PORT || process.env.PORT || 3100);
const httpTimeoutMs = Number(process.env.STATUS_HTTP_TIMEOUT_MS || 120000);

let activeWakePromise = null;
let lastWake = null;

app.use(express.json());

async function runWake(targetUrl) {
  if (activeWakePromise) {
    return activeWakePromise;
  }

  activeWakePromise = Promise.race([
    targetUrl ? getColabStatusForUrl(targetUrl) : getColabStatus(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout ao obter status do Colab")), httpTimeoutMs)
    ),
  ])
    .then((status) => {
      lastWake = {
        at: new Date().toISOString(),
        ok: true,
        status,
      };
      return status;
    })
    .catch((error) => {
      lastWake = {
        at: new Date().toISOString(),
        ok: false,
        error: error?.message || String(error),
      };
      throw error;
    })
    .finally(() => {
      activeWakePromise = null;
    });

  return activeWakePromise;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, lastWake, activeWake: Boolean(activeWakePromise) });
});

app.get("/status", async (_req, res) => {
  try {
    console.log("[/status] recebido");
    const status = await runWake();
    console.log("[/status] respondendo");
    res.json(status);
  } catch (error) {
    console.error("[/status] erro:", error);
    res.status(500).json({
      error: "Falha ao obter status do Colab",
      details: error.message
    });
  }
});

// Endpoint explícito para acordar/preparar runtime do Colab
app.post("/wake", async (_req, res) => {
  try {
    console.log("[/wake] recebido");
    const targetUrl = _req.body?.url;
    const status = await runWake(targetUrl);
    res.json({ ok: true, message: "Colab acordado e pronto", status });
  } catch (error) {
    console.error("[/wake] erro:", error);
    res.status(500).json({
      ok: false,
      error: "Falha ao acordar Colab",
      details: error.message,
    });
  }
});

// Alias para integrações que chamam /start
app.post("/start", async (_req, res) => {
  try {
    console.log("[/start] recebido");
    const targetUrl = _req.body?.url;
    const status = await runWake(targetUrl);
    res.json({ ok: true, message: "Colab iniciado", status });
  } catch (error) {
    console.error("[/start] erro:", error);
    res.status(500).json({
      ok: false,
      error: "Falha ao iniciar Colab",
      details: error.message,
    });
  }
});

const server = app.listen(port, () => {
  console.log(`Servidor worker do Colab iniciado na porta ${port}`);
});

const shutdown = async () => {
  server.close();
  await closeBrowser();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
