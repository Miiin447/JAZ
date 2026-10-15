'use strict';
/* Real Chromium interaction smoke. No user storage, account, external API or network. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const publicNames = new Set(['index.html','sw.js','manifest.webmanifest',
  'favicon.png','apple-touch-icon.png','icon-192.png','icon-512.png','og-image.png']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const server = http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');
  if (!publicNames.has(name)) {res.writeHead(404);res.end('not found');return}
  const file=path.join(root,name);
  res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address='http://127.0.0.1:'+server.address().port+'/';
  const executable=process.env.CHROME_PATH||'/usr/bin/google-chrome';
  const browser=await puppeteer.launch({headless:true,executablePath:executable,
    args:['--no-sandbox','--disable-dev-shm-usage','--no-first-run']});
  try{
    const page=await browser.newPage();
    const errs=[], dialogs=[];
    page.on('pageerror',e=>errs.push(e.message));
    page.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept()});
    await page.goto(address,{waitUntil:'load',timeout:90000});
    assert.equal(await page.title(),'Chordinary v38 · Harmony Training Lab');
    assert.equal(await page.$eval('#homeLessons',x=>x.textContent),'0');

    // The full UI really switches panes, and an answered inline quiz stays locked.
    await page.evaluate(()=>document.querySelector('#mainNav [data-view="learning"]').click());
    await page.waitForSelector('#lessonPane .inlineOpts button');
    await page.evaluate(()=>document.querySelector('#lessonPane .inlineOpts button').click());
    assert.equal(await page.evaluate(()=>STATE.quizTotal),1);
    await page.evaluate(()=>document.querySelector('#mainNav [data-view="progress"]').click());
    await page.evaluate(()=>document.querySelector('#mainNav [data-view="learning"]').click());
    assert.equal(await page.$eval('#lessonPane .inlineOpts button',x=>x.disabled),true);
    assert.equal(await page.evaluate(()=>STATE.quizTotal),1,'inline answer double-counted on tab switch');

    // Main quiz feedback must persist after a real nav redraw.
    await page.evaluate(()=>document.querySelector('#mainNav [data-view="quiz"]').click());
    await page.waitForSelector('#quizOptions .option');
    await page.evaluate(()=>document.querySelector('#quizOptions .option').click());
    const count=await page.evaluate(()=>STATE.quizTotal);
    assert.equal(count,2);
    await page.evaluate(()=>document.querySelector('#mainNav [data-view="progress"]').click());
    await page.evaluate(()=>document.querySelector('#mainNav [data-view="quiz"]').click());
    assert.equal(await page.$eval('#quizOptions .option',x=>x.disabled),true);
    assert.ok((await page.$eval('#quizFeedback',x=>x.textContent)).includes('정답')||
              (await page.$eval('#quizFeedback',x=>x.textContent)).includes('오답'));
    assert.equal(await page.evaluate(()=>STATE.quizTotal),count,'main answer double-counted on tab switch');

    // Invalid imported backup must not erase completed sessions.
    await page.evaluate(()=>{
      document.querySelector('#mainNav [data-view="data"]').click();
      document.getElementById('dataText').value='{}';
      document.getElementById('importDataBtn').click();
    });
    assert.equal(await page.evaluate(()=>STATE.quizTotal),count);
    assert.ok(dialogs.some(x=>x.message.includes('학습 기록이 포함된 백업')));

    // Reload using a corrupted localStorage record; do not silently overwrite it.
    await page.evaluate(()=>localStorage.setItem('chordinary_state','{invalid-json'));
    await page.reload({waitUntil:'load'});
    assert.equal(await page.evaluate(()=>localStorage.getItem('chordinary_state')),'{invalid-json');
    await page.evaluate(()=>{
      document.querySelector('#mainNav [data-view="learning"]').click();
      document.querySelector('#lessonPane .inlineOpts button').click();
    });
    assert.equal(await page.evaluate(()=>localStorage.getItem('chordinary_state')),'{invalid-json');
    assert.ok(errs.length===0,'JavaScript page errors: '+errs.join('; '));
    console.log('Chromium integration PASS: root route, inline quiz, main quiz, restore safety and corrupt storage');
  }finally{
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
