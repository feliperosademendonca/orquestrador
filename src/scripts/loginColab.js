const puppeteer = require('puppeteer');
const fs = require('fs').promises;

(async () => {
  console.log('🚀 Abrindo navegador VISÍVEL para você fazer login manual...');

  const browser = await puppeteer.launch({
    headless: false,           // ← importante: visível para você logar
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const notebookUrl = 'https://colab.research.google.com/drive/1F5e7FPE9CKj9aknAYyTy86leNABt9YbD';

  console.log('🌐 Abrindo o notebook... Faça login na conta Google quando pedir.');
  await page.goto(notebookUrl, { waitUntil: 'networkidle2', timeout: 120000 });

  console.log('\n✅ Faça o login completo (email + senha + 2FA se tiver).');
  console.log('Depois que o notebook carregar e aparecer o botão "Connect" ou o runtime conectado...');
  console.log('Volte aqui no terminal e pressione ENTER para salvar os cookies.');

  // Aguarda você pressionar ENTER
  await new Promise(resolve => {
    process.stdin.once('data', () => resolve());
  });

  // Salva os cookies
  const cookies = await page.cookies();
  await fs.writeFile('colab-cookies.json', JSON.stringify(cookies, null, 2));

  console.log('✅ Cookies salvos com sucesso em "colab-cookies.json"!');
  console.log('Agora você pode rodar o script principal (collanInit.js) quantas vezes quiser.');

  await browser.close();
})();