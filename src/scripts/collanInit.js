const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('🚀 Iniciando Puppeteer...');

  const browser = await puppeteer.launch({
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--disable-gpu'
    ],
    timeout: 90000,
    ignoreHTTPSErrors: true,
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  const notebookUrl = 'https://colab.research.google.com/drive/1F5e7FPE9CKj9aknAYyTy86leNABt9YbD';

  console.log('🌐 Abrindo notebook...');
  await page.goto(notebookUrl, { waitUntil: 'networkidle2', timeout: 120000 });

  const currentUrl = page.url();
  console.log('📍 URL atual:', currentUrl);

  if (currentUrl.includes('accounts.google.com')) {
    console.log('🔐 Parou na tela de login do Google.');
    console.log('   Opções:');
    console.log('   1. Faça login manualmente agora (abra a URL acima no navegador normal).');
    console.log('   2. Ou me diga seu email/senha para tentar automatizar (não recomendo por segurança).');
    console.log('   3. Melhor: vamos salvar cookies depois do login manual.');

    await new Promise(r => setTimeout(r, 30000));
    await browser.close();
    return;
  }

  // === Tenta conectar runtime usando o seletor que você passou ===
  console.log('\n🔄 Tentando conectar runtime (clicando no botão com classe "touch")...');

  try {
    // Espera o botão com classe touch aparecer
    await page.waitForSelector('span.touch', { timeout: 15000 });

    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('span.touch');
      if (btn) {
        // Tenta subir até o botão real (muitas vezes o span está dentro de um button)
        let target = btn;
        while (target && target.tagName !== 'BUTTON') {
          target = target.parentElement;
        }
        if (target) {
          target.click();
          return true;
        } else {
          btn.click(); // fallback
          return true;
        }
      }
      return false;
    });

    if (clicked) {
      console.log('✅ Botão com classe "touch" clicado!');
    } else {
      console.log('⚠️ Encontrou o span.touch mas não conseguiu clicar.');
    }
  } catch (e) {
    console.log('⚠️ Não encontrou botão com classe "touch" ainda:', e.message);
  }

  // Espera o runtime conectar
  await new Promise(r => setTimeout(r, 12000));

  // Verifica status
  const status = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const connected = text.includes('RAM') || 
                     text.includes('Disk') || 
                     text.includes('Connected') ||
                     document.querySelector('[aria-label*="Connected"]') !== null;

    return {
      seemsConnected: connected,
      url: window.location.href,
      title: document.title
    };
  });

  console.log('\n📊 STATUS DO RUNTIME:');
  console.log('   Conectado?', status.seemsConnected ? '✅ SIM (provável)' : '❌ Ainda não detectado');
  console.log('   URL para você validar:', status.url);

  console.log('\n⏳ Mantendo aberto por 40 segundos... Abra a URL acima no seu navegador para conferir o círculo verde "Connected".');
  await new Promise(r => setTimeout(r, 40000));

  // await browser.close();
})();