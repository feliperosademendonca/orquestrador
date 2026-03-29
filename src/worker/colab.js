const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const COLAB_URL = process.env.COLAB_URL;
const STORAGE_STATE_PATH = process.env.STORAGE_STATE_PATH || path.join(process.cwd(), "playwright-storage.json");
const BROWSER_HEADLESS = (process.env.BROWSER_HEADLESS || "true").toLowerCase() === "true";
const STATUS_STRATEGY = (process.env.STATUS_STRATEGY || "network").toLowerCase();
const KEEP_PAGE_OPEN = (process.env.KEEP_PAGE_OPEN || "true").toLowerCase() === "true";
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || 90000);
const PLAYWRIGHT_LOG = (process.env.PLAYWRIGHT_LOG || "false").toLowerCase() === "true";
const FORCE_GPU = (process.env.FORCE_GPU || "false").toLowerCase() === "true";
const GPU_VALIDATE = (process.env.GPU_VALIDATE || "false").toLowerCase() === "true";

const STATUS_CELL_CODE = `import json, os, platform, subprocess, time

def meminfo():
    info = {}
    try:
        with open('/proc/meminfo') as f:
            for line in f:
                key, val = line.split(':', 1)
                info[key.strip()] = int(val.strip().split()[0]) * 1024
    except Exception:
        pass
    return info

def cpuinfo():
    return {"count": os.cpu_count()}

def gpuinfo():
    try:
        out = subprocess.check_output(['bash', '-lc', 'nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader']).decode().strip()
        if not out:
            return []
        gpus = []
        for line in out.splitlines():
            parts = [p.strip() for p in line.split(',')]
            gpus.append({"name": parts[0], "memory_total": parts[1], "memory_used": parts[2]})
        return gpus
    except Exception:
        return []

status = {
    "initialized": True,
    "platform": platform.platform(),
    "cpu": cpuinfo(),
    "mem": meminfo(),
    "gpu": gpuinfo(),
    "timestamp": time.time()
}
print(json.dumps(status))
`;

let browser;
let context;
let page;

function attachPlaywrightLogs(page) {
  if (!PLAYWRIGHT_LOG) return;
  page.on("console", (msg) => console.log(`[pw:console] ${msg.type()} ${msg.text()}`));
  page.on("pageerror", (error) => console.log("[pw:pageerror]", error.message || error));
  page.on("request", (request) => {
    const type = request.resourceType();
    if (type === "xhr" || type === "fetch") console.log(`[pw:request] ${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (type === "xhr" || type === "fetch") console.log(`[pw:response] ${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    console.log(`[pw:requestfailed] ${request.url()} ${request.failure()?.errorText || ""}`);
  });
}

function resolveColabUrl(targetUrl) {
  return targetUrl || COLAB_URL;
}

function requireEnv(targetUrl) {
  if (!resolveColabUrl(targetUrl)) {
    throw new Error("COLAB_URL não definido. Configure no .env ou envie URL na requisição.");
  }
}

function ensureStorageState() {
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error("Arquivo de sessão não encontrado. Rode 'npm run colab:login' (ou 'npm run login') para autenticar no Google e salvar a sessão.");
  }
}

async function getContext(targetUrl) {
  requireEnv(targetUrl);
  ensureStorageState();
  if (!browser) browser = await chromium.launch({ headless: BROWSER_HEADLESS });
  if (!context) context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
  return context;
}

// ─── Lê o acelerador atual abrindo o diálogo e fechando sem salvar ────────────
async function getAcceleratorFromDialog(page) {
  const runtimeMenu = page.locator("#runtime-menu-button");
  if (await runtimeMenu.isVisible().catch(() => false)) {
    await runtimeMenu.click();
    await page.waitForTimeout(400);
  } else {
    console.log("[colab] menu runtime não encontrado para ler acelerador");
    return { value: null, label: null };
  }

  const changeType = page.locator('[command="change-runtime-type"]');
  if (await changeType.first().isVisible().catch(() => false)) {
    await changeType.first().click();
  } else {
    await page.keyboard.press("Escape");
    return { value: null, label: null };
  }

  await page.waitForTimeout(1000);

  const accelerator = await page.evaluate(() => {
    function findInShadows(root, selector) {
      const direct = root.querySelector(selector);
      if (direct) return direct;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const found = findInShadows(el.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const checked = findInShadows(document, 'input[name="accelerator"]:checked');
    if (checked) return { value: checked.value, label: checked.getAttribute('aria-label') };
    return { value: null, label: null };
  });

  // Fecha sem salvar
  const cancelBtn = page.locator('md-text-button[dialogaction="cancel"], md-text-button[dialogaction="close"]');
  if (await cancelBtn.first().isVisible().catch(() => false)) {
    await cancelBtn.first().click();
  } else {
    await page.keyboard.press("Escape");
  }

  await page.waitForTimeout(500);
  return accelerator;
}

// ─── Desconecta o runtime ─────────────────────────────────────────────────────
async function disconnectRuntime(page) {
  console.log("[colab] tentando desconectar runtime");

  const alreadyDisconnected = await page.evaluate(() => {
    const host = document.querySelector('colab-connect-button');
    if (!host) return true;
    const state = host.getAttribute('data-state') || host.getAttribute('state') || "";
    const text = host.textContent || "";
    return /^connect$/i.test(state) || /conectar|^connect$/i.test(text.trim());
  });

  if (alreadyDisconnected) {
    console.log("[colab] runtime já desconectado — pulando disconnect");
    return;
  }

  const runtimeMenu = page.locator("#runtime-menu-button");
  if (await runtimeMenu.isVisible().catch(() => false)) {
    await runtimeMenu.click();
    await page.waitForTimeout(500);
  } else {
    const runtimeFallback = page.getByRole("button", { name: /runtime|ambiente de execução/i });
    if (await runtimeFallback.isVisible().catch(() => false)) {
      await runtimeFallback.click();
      await page.waitForTimeout(500);
    } else {
      console.log("[colab] menu runtime não encontrado — pulando disconnect");
      return;
    }
  }

  const disconnectItem = page.locator(
    '[command="disconnect-runtime"]:not([aria-disabled="true"]), [command="disconnect-and-delete-runtime"]:not([aria-disabled="true"])'
  );

  if (await disconnectItem.first().isVisible().catch(() => false)) {
    console.log("[colab] clicando Desconectar e excluir ambiente (command)");
    await disconnectItem.first().click();
    await page.waitForTimeout(1000);
  } else {
    console.log("[colab] item disconnect não disponível — fechando menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return;
  }

  await page.waitForTimeout(500);
  const confirmed = await page.evaluate(() => {
    const host = document.querySelector('md-text-button[dialogaction="ok"]');
    if (!host) return false;
    host.click();
    const btn = host.shadowRoot && host.shadowRoot.querySelector('button#button');
    if (btn) btn.click();
    return true;
  });
  if (confirmed) console.log("[colab] confirmou desconexão");

  await page.waitForTimeout(3000);
  console.log("[colab] runtime desconectado — pronto para configurar GPU");
}

// ─── Abre a página e decide se precisa reconfigurar GPU ───────────────────────
async function openColabPage(targetUrl) {
  const ctx = await getContext(targetUrl);
  const colabUrl = resolveColabUrl(targetUrl);
  if (!page) {
    page = await ctx.newPage();
    attachPlaywrightLogs(page);
    console.log("[colab] abrindo página");
    page.on("domcontentloaded", () => console.log("[colab] DOM carregado"));
    page.on("load", () => console.log("[colab] Página carregada (load event)"));
    page.on("networkidle", () => console.log("[colab] Rede ociosa"));
    await page.goto(colabUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    console.log("[colab] página carregada");

    if (FORCE_GPU) {
      const accelerator = await getAcceleratorFromDialog(page);
      console.log("[colab] acelerador atual:", accelerator);

      const isAlreadyT4 =
        accelerator.value === "GPU,T4" ||
        /T4/i.test(accelerator.label || "") ||
        /T4/i.test(accelerator.value || "");

      if (isAlreadyT4) {
        console.log("[colab] já está na T4 — pulando reconfiguração e desconexão");
      } else {
        console.log("[colab] acelerador diferente de T4 — desconectando para reconfigurar");
        await disconnectRuntime(page);
      }
    }
  }
  return page;
}

// ─── Garante T4 configurada ───────────────────────────────────────────────────
async function ensureGpuRuntime(page) {
  console.log("[colab] abrindo menu Runtime para configurar T4");

  // Fecha qualquer diálogo bloqueante
  const yesNoDialog = page.locator('mwc-dialog.yes-no-dialog[open]');
  if (await yesNoDialog.isVisible().catch(() => false)) {
    console.log("[colab] diálogo yes-no-dialog detectado — fechando");
    await page.evaluate(() => {
      function findInShadows(root, selector) {
        const direct = root.querySelector(selector);
        if (direct) return direct;
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const found = findInShadows(el.shadowRoot, selector);
            if (found) return found;
          }
        }
        return null;
      }
      const dialog = document.querySelector('mwc-dialog.yes-no-dialog[open]');
      if (!dialog) return false;
      const cancelBtn =
        dialog.querySelector('[dialogaction="cancel"], [dialogaction="close"], [slot="secondaryAction"]') ||
        findInShadows(dialog, 'button');
      if (cancelBtn) { cancelBtn.click(); return true; }
      dialog.removeAttribute('open');
      return true;
    });
    await yesNoDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(500);
  }

  // Abre menu Runtime
  const runtimeTop = page.locator("#runtime-menu-button");
  if (await runtimeTop.isVisible().catch(() => false)) {
    console.log("[colab] clicando menu Ambiente de execução (id)");
    await runtimeTop.click();
    await page.waitForTimeout(500);
  } else {
    const runtimeFallback = page.getByRole("button", { name: /runtime|ambiente de execução/i });
    if (await runtimeFallback.isVisible().catch(() => false)) {
      console.log("[colab] clicando menu Ambiente de execução (fallback)");
      await runtimeFallback.click();
      await page.waitForTimeout(500);
    } else {
      console.log("[colab] menu Ambiente de execução não encontrado");
      return { ok: false, reason: "menu-runtime" };
    }
  }

  // Clica em "Alterar tipo"
  await page.waitForSelector(
    '[command="change-runtime-type"], [command="change-runtime-type"] .goog-menuitem-content',
    { timeout: 5000 }
  ).catch(() => null);

  const changeType = page.locator('[command="change-runtime-type"], [command="change-runtime-type"] .goog-menuitem-content');
  if (await changeType.first().isVisible().catch(() => false)) {
    console.log("[colab] clicando Alterar tipo de ambiente");
    await changeType.first().click();
  } else {
    const fallbackMenu = page.getByRole("menuitem", { name: /alterar o tipo de ambiente|change runtime type/i });
    if (await fallbackMenu.isVisible().catch(() => false)) {
      console.log("[colab] clicando Alterar tipo de ambiente (fallback)");
      await fallbackMenu.click();
    } else {
      console.log("[colab] item Alterar tipo não encontrado");
      return { ok: false, reason: "menu-change-type" };
    }
  }

  await page.waitForTimeout(1500);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 5000 }).catch(() => null);

  // Seleciona T4 via shadow DOM recursivo
  const forceChecked = await page.evaluate(() => {
    function findInShadows(root, selector) {
      const direct = root.querySelector(selector);
      if (direct) return direct;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const found = findInShadows(el.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const input = findInShadows(document, 'input[name="accelerator"][aria-label="GPUs: T4"]');
    if (!input) return false;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const host = input.getRootNode()?.host;
    if (host) {
      host.click();
      host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    return input.checked;
  });

  if (forceChecked) {
    console.log("[colab] T4 selecionada via shadow DOM recursivo");
  } else {
    console.log("[colab] T4 não encontrada — abortando");
    return { ok: false, reason: "gpu-radio" };
  }

  await page.waitForTimeout(500);

  // Clica Salvar via shadow DOM
  const saved = await page.evaluate(() => {
    function findButtonByText(root, text) {
      for (const el of root.querySelectorAll('button')) {
        if ((el.innerText || el.textContent || '').trim().toLowerCase() === text) return el;
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const found = findButtonByText(el.shadowRoot, text);
          if (found) return found;
        }
      }
      return null;
    }
    const host = document.querySelector('md-text-button[dialogaction="ok"]');
    if (host) {
      host.click();
      host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const btn = host.shadowRoot && host.shadowRoot.querySelector('button#button');
      if (btn) btn.click();
      return true;
    }
    const btn = findButtonByText(document, 'salvar') || findButtonByText(document, 'ok');
    if (btn) { btn.click(); btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
    return false;
  });

  if (saved) {
    console.log("[colab] clicou Salvar via shadow DOM");
  } else {
    console.log("[colab] botão Salvar não encontrado");
    return { ok: false, reason: "save-button" };
  }

  await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(1000);
  console.log("[colab] T4 configurada — pronto para conectar ao runtime");
  return { ok: true };
}

// ─── Conecta ao runtime ───────────────────────────────────────────────────────
// Ordem: 1. configura GPU (se FORCE_GPU e necessário) → 2. conecta → 3. aguarda
async function ensureRuntimeConnected(page) {
  console.log("[colab] aguardando página estabilizar");
  await page.waitForSelector("colab-connect-button", { timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(1000);

  let clicked = false;

  if (FORCE_GPU) {
    const accelerator = await getAcceleratorFromDialog(page);
    const isAlreadyT4 =
      accelerator.value === "GPU,T4" ||
      /T4/i.test(accelerator.label || "") ||
      /T4/i.test(accelerator.value || "");

    if (isAlreadyT4) {
      const alreadyConnected = await detectConnected(page);
      if (alreadyConnected.connected) {
        console.log("[colab] já na T4 e conectado — nada a fazer");
        return { clicked: false, connected: true, waitConnected: true, label: alreadyConnected.label };
      }
      console.log("[colab] já na T4 mas desconectado — só vai conectar");
    } else {
      console.log("[colab] FORCE_GPU ativo — configurando T4 antes de conectar");
      const gpuResult = await ensureGpuRuntime(page).catch((error) => {
        console.log("[colab] falha ao configurar GPU:", error.message || error);
        return { ok: false };
      });
      console.log("[colab] resultado configuração GPU:", gpuResult);
      if (!gpuResult || gpuResult.ok !== true) {
        console.log("[colab] abortando — GPU não configurada");
        return { clicked: false, connected: false, waitConnected: false, label: null, gpu: gpuResult };
      }
      console.log("[colab] GPU configurada — prosseguindo para conectar");
    }
  }

  const blockingDialog = page.locator("mwc-dialog.change-runtime-type");
  if (await blockingDialog.isVisible().catch(() => false)) {
    await blockingDialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => null);
  }

  const candidates = [
    page.getByRole("button", { name: /Connect|Conectar/i }),
    page.getByRole("button", { name: /Reconnect|Reconectar/i }),
    page.locator('button[aria-label*="Connect" i]'),
    page.locator('button[aria-label*="Conectar" i]'),
    page.locator('colab-connect-button button')
  ];

  for (const button of candidates) {
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await page.waitForTimeout(1000);
      clicked = true;
      console.log("[colab] clicou no botão connect");
      break;
    }
  }

  if (!clicked) {
    const shadowClick = await page.evaluate(() => {
      try {
        const host = document.querySelector('colab-connect-button');
        const shadow = host && host.shadowRoot;
        const btn = shadow && shadow.querySelector('button');
        if (btn) { btn.focus(); btn.click(); }
        if (host) host.click();
        return true;
      } catch (e) { return false; }
    });
    if (shadowClick) {
      clicked = true;
      console.log("[colab] clicou no botão connect (shadow fallback)");
    }
  }

  // Aguarda conexão com log do estado a cada ciclo para diagnóstico
  let waitConnected = false;
  let connectedLabel = null;

  console.log("[colab] aguardando runtime conectar...");
  const start = Date.now();
  while (Date.now() - start < CONNECT_TIMEOUT_MS) {
    const detected = await detectConnected(page).catch(() => ({ connected: false, label: null }));
    console.log("[colab] estado conexão:", detected);
    if (detected.connected) {
      waitConnected = true;
      connectedLabel = detected.label || null;
      console.log("[colab] runtime conectado:", detected);
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!waitConnected) {
    console.log("[colab] timeout — runtime não conectou dentro do prazo");
  }

  // getRuntimeUiStatus inline para não depender de página ainda aberta
  const ui = await detectConnected(page).catch(() => ({ connected: false, label: null }));
  return { clicked, connected: ui.connected, waitConnected, label: ui.label || connectedLabel };
}

async function detectConnected(page) {
  return await page.evaluate(() => {
    const host = document.querySelector('colab-connect-button');
    if (!host) return { connected: false, label: null, source: 'no-host' };

    const shadow = host.shadowRoot;
    if (!shadow) return { connected: false, label: null, source: 'no-shadow' };

    // Sinal 1: colab-toolbar-button#connect com tooltiptext "Conectado"
    const connectBtn = shadow.querySelector('colab-toolbar-button#connect');
    if (connectBtn) {
      const tooltip = connectBtn.getAttribute('tooltiptext') || "";
      if (/conectado|connected/i.test(tooltip)) {
        return { connected: true, label: tooltip.split('\n')[0].trim(), source: 'tooltip' };
      }
    }

    // Sinal 2: colab-usage-sparkline visível (RAM/Disco) — só aparece quando conectado
    const sparkline = shadow.querySelector('colab-usage-sparkline');
    if (sparkline) {
      return { connected: true, label: 'ram-disk-visible', source: 'sparkline' };
    }

    return { connected: false, label: null, source: 'not-found' };
  });
}

function createNetworkCollector(page) {
  const responses = [];
  page.on("response", async (response) => {
    try {
      const req = response.request();
      const type = req.resourceType();
      if (type !== "xhr" && type !== "fetch") return;
      const url = response.url();
      if (!/colab|googleusercontent|googleapis|notebooks|kernel|runtime|session|connect|api/i.test(url)) return;
      const headers = response.headers();
      const contentType = headers["content-type"] || "";
      if (!contentType.includes("application/json")) return;
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (error) { return; }
      responses.push({
        url,
        status: response.status(),
        keys: data && typeof data === "object" ? Object.keys(data).slice(0, 30) : [],
        data
      });
      if (responses.length > 10) responses.shift();
    } catch (error) { return; }
  });
  return () => responses;
}

async function getRuntimeUiStatus(page) {
  const detected = await detectConnected(page);
  return { connected: detected.connected, label: detected.label };
}

async function runStatusCell(page) {
  await page.click("body");
  await page.keyboard.press("Control+M");
  await page.keyboard.press("B");
  await page.keyboard.type(STATUS_CELL_CODE, { delay: 5 });
  await page.keyboard.press("Shift+Enter");

  const jsonText = await page.waitForFunction(() => {
    const selectors = [".output_subarea", ".output_subarea pre", ".cell-output", ".cell-output pre", ".output", "pre"];
    const nodes = selectors.flatMap((sel) => Array.from(document.querySelectorAll(sel)));
    const text = nodes.map((n) => n.innerText || n.textContent || "").join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { JSON.parse(match[0]); return match[0]; } catch (e) { return null; }
  }, {}, { timeout: 90000 });

  const raw = await jsonText.jsonValue();
  if (!raw) throw new Error("Não foi possível ler o JSON de saída da célula.");
  return JSON.parse(raw);
}

async function getColabStatus() {
  const page = await openColabPage();
  try {
    if (STATUS_STRATEGY === "cell") {
      console.log("[colab] estratégia: cell");
      const connection = await ensureRuntimeConnected(page);
      const status = await runStatusCell(page);
      return { strategy: "cell", connection, status };
    }

    console.log("[colab] estratégia: network");
    const getResponses = createNetworkCollector(page);
    const connection = await ensureRuntimeConnected(page);
    await page.waitForTimeout(2000);
    const uiStatus = await getRuntimeUiStatus(page);
    const responses = getResponses();
    return {
      strategy: "network",
      pageTitle: await page.title(),
      connection,
      ui: uiStatus,
      network: responses
    };
  } finally {
    if (!KEEP_PAGE_OPEN && page) {
      await page.close();
      page = undefined;
    }
  }
}

async function getColabStatusForUrl(targetUrl) {
  const page = await openColabPage(targetUrl);
  try {
    if (STATUS_STRATEGY === "cell") {
      console.log("[colab] estratégia: cell");
      const connection = await ensureRuntimeConnected(page);
      const status = await runStatusCell(page);
      return { strategy: "cell", connection, status, url: resolveColabUrl(targetUrl) };
    }

    console.log("[colab] estratégia: network");
    const getResponses = createNetworkCollector(page);
    const connection = await ensureRuntimeConnected(page);
    await page.waitForTimeout(2000);
    const uiStatus = await getRuntimeUiStatus(page);
    const responses = getResponses();
    return {
      strategy: "network",
      pageTitle: await page.title(),
      connection,
      ui: uiStatus,
      network: responses,
      url: resolveColabUrl(targetUrl),
    };
  } finally {
    if (!KEEP_PAGE_OPEN && page) {
      await page.close();
      page = undefined;
    }
  }
}

async function closeBrowser() {
  if (page) { await page.close(); page = undefined; }
  if (context) { await context.close(); context = undefined; }
  if (browser) { await browser.close(); browser = undefined; }
}

module.exports = { getColabStatus, getColabStatusForUrl, closeBrowser };