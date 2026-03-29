require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

const COLAB_URL = process.env.COLAB_URL;
const STORAGE_STATE_PATH = process.env.STORAGE_STATE_PATH || path.join(process.cwd(), "playwright-storage.json");
const USER_DATA_DIR = process.env.USER_DATA_DIR || path.join(process.cwd(), ".pw-user-data");
const PLAYWRIGHT_CHANNEL = process.env.PLAYWRIGHT_CHANNEL || "chrome";

if (!COLAB_URL) {
  console.error("COLAB_URL não definido. Configure no .env antes de executar.");
  process.exit(1);
}

(async () => {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: PLAYWRIGHT_CHANNEL,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const page = await context.newPage();

  await page.goto(COLAB_URL, { waitUntil: "domcontentloaded" });

  console.log("Faça login no Google e confirme que o notebook abriu.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question("Pressione ENTER para salvar a sessão...", async () => {
    await context.storageState({ path: STORAGE_STATE_PATH });
    await context.close();
    rl.close();
    console.log(`Sessão salva em ${STORAGE_STATE_PATH}`);
  });
})();
