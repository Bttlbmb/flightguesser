import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createGameServer} from '../../../scripts/serve.mjs';

// One-off layout review: real game assets, local recordings, no provider traffic.
const root=fileURLToPath(new URL('../../../',import.meta.url));
const phase=process.argv.find(arg=>arg.startsWith('--phase='))?.split('=')[1] || 'baseline';
if(!['baseline','final'].includes(phase))throw new Error('Use baseline or final phase');
const out=phase==='baseline'?'/private/tmp/flightguesser-resolution-audit-baseline':resolve(root,'docs/design/resolution-audit/results');
await mkdir(out,{recursive:true});
const require=createRequire(process.env.FLIGHTGUESSER_PLAYWRIGHT_PACKAGE || '/Users/maxnurnus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json');
const {chromium}=require('playwright');
const recordings=JSON.parse(await readFile(resolve(root,'public/data/practice.json'),'utf8'));
const server=createGameServer({directory:resolve(root,'public')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_BIN || '/Users/maxnurnus/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const issues=[],views=[],errors=[],checks=[];
const sizes=[
  [280,640],[320,568],[360,640],[375,667],[390,844],[412,915],[430,932],
  [540,720],[699,900],[700,900],[701,900],[768,1024],[834,1194],[1024,768],
  [1280,720],[1440,900],[1920,1080],[2560,1440],[320,360],[390,450],[390,300],
  [568,320],[667,375],[844,390],[932,430]
];
async function tool(page,name,args={}){return page.evaluate(({name,args})=>window.qaTools[name].execute(args),{name,args});}
async function boot(page,{fixture,brokenData=false}={}){
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.qaTools={};Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool(tool){window.qaTools[tool.name]=tool;}}});});
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  if(fixture||brokenData)await page.route('**/data/practice.json',route=>route.fulfill(brokenData?{status:500,body:'Unavailable'}:{json:[fixture]}));
  await page.goto(base);await page.waitForFunction(()=>window.qaTools.start_practice_round);
}
async function frame(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function capture(page,label,coarse){
  // A beyond-viewport capture in this Chromium build resets coarse-pointer
  // emulation. Phone captures use the real viewport to preserve the tested UI.
  await page.screenshot({path:resolve(out,`${label}.png`),fullPage:!coarse});
}
async function inspect(page,label,{screenshot=false}={}){
  await frame(page);
  const measurement=await page.evaluate(()=>{
    const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && !e.closest('.sr-only');
    const r=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
    const findings=[];
    if(document.documentElement.scrollWidth>innerWidth+1)findings.push({kind:'horizontal overflow',width:innerWidth,scrollWidth:document.documentElement.scrollWidth});
    for(const selector of ['.wordmark','.entry h1','.intro','.privacy','.difficulty-control','.difficulty-note','.round-meta','.guess-form-title','.clue-book-header','.book-clue','.airport-city','.airport-name','.guess-row','.round-end h1','.destination','.route-note','.round-end .clue-detail','.round-options','.footer','.dialog-top','#info-content']){
      for(const e of document.querySelectorAll(selector)){
        if(!visible(e))continue;
        const box=r(e);
        if(box.x < -1 || box.right>innerWidth+1)findings.push({kind:'content outside page',selector,text:e.textContent.trim().slice(0,95),...box});
        if(e.clientWidth && e.scrollWidth>e.clientWidth+2 && !['SELECT','INPUT'].includes(e.tagName))findings.push({kind:'content exceeds container',selector,text:e.textContent.trim().slice(0,95),containerWidth:e.clientWidth,scrollWidth:e.scrollWidth});
      }
    }
    const pairs=[['.wordmark','#help-button','brand/help'],['.clue-book-header h2','.clue-book-actions','clue header'],['.guess-form-title label','.guesses-left','guess label/count']];
    for(const [a,b,name] of pairs){
      const left=document.querySelector(a),right=document.querySelector(b);if(!left||!right||!visible(left)||!visible(right))continue;
      const x=r(left),y=r(right);
      if(Math.min(x.right,y.right)-Math.max(x.x,y.x)>1 && Math.min(x.bottom,y.bottom)-Math.max(x.y,y.y)>1)findings.push({kind:'overlapping controls/text',name,a:x,b:y});
    }
    const popup=document.querySelector('#destination-results');
    if(popup && visible(popup)){
      const p=r(popup),top=visualViewport?.offsetTop||0,bottom=top+(visualViewport?.height||innerHeight);
      if(p.y<top-1 || p.bottom>bottom+1)findings.push({kind:'search popup outside visible viewport',popup:p,top,bottom});
      const input=document.querySelector('#destination-input'),field=r(input);
      if(document.activeElement===input && (field.y<top-1 || field.bottom>bottom+1))findings.push({kind:'focused search field clipped',field,top,bottom});
    }
    const dialog=document.querySelector('dialog[open]');
    if(dialog){const d=r(dialog);if(d.y<-1 || d.bottom>innerHeight+1 || d.x<0 || d.right>innerWidth+1)findings.push({kind:'dialog outside viewport',dialog:d});}
    const book=document.querySelector('#clue-book-content'),toggle=document.querySelector('#clue-book-toggle');
    if(book && !book.hidden && document.querySelector('.book-clue .flight-globe'))findings.push({kind:'globe inside clue book'});
    const pointers=matchMedia('(pointer: coarse)').matches;
    if(pointers && innerWidth<=1000 && innerHeight<=500 && toggle && !visible(toggle))findings.push({kind:'phone landscape cannot collapse book'});
    const active=document.activeElement;
    if(active && active!==document.body && !visible(active))findings.push({kind:'focus left on hidden control',tag:active.tagName,id:active.id});
    return {width:innerWidth,height:innerHeight,coarse:pointers,findings,bookOpen:book?!book.hidden:null,clues:document.querySelectorAll('.book-clue').length};
  });
  views.push({label,...measurement,findings:undefined});
  for(const finding of measurement.findings)issues.push({label,width:measurement.width,height:measurement.height,...finding});
  if(screenshot){
    await capture(page,label,measurement.coarse);
    const after=await page.evaluate(()=>({coarse:matchMedia('(pointer: coarse)').matches,bookOpen:document.querySelector('#clue-book-content')?!document.querySelector('#clue-book-content').hidden:null}));
    if(after.coarse!==measurement.coarse || after.bookOpen!==measurement.bookOpen)throw new Error(`Capture changed media or book state: ${label}`);
  }
  return measurement;
}
async function submit(page,query){
  const matches=await tool(page,'search_cities',{query});
  if(!matches.cities.length)throw new Error(`No city match: ${query}`);
  return tool(page,'submit_city_guess',{cityId:matches.cities[0].id});
}
async function textZoom(page,label){
  await page.evaluate(()=>{
    window.auditFontStyles=[...document.querySelectorAll('body,h1,h2,h3,p,label,input,select,button,a,span,small,dt,dd,li')].map(e=>{const s=getComputedStyle(e),size=parseFloat(s.fontSize),height=parseFloat(s.lineHeight);return {e,style:e.getAttribute('style'),size,ratio:Number.isFinite(height)?height/size:null};});
    for(const {e,size,ratio} of window.auditFontStyles){e.style.setProperty('font-size',`${size*2}px`,'important');if(ratio)e.style.setProperty('line-height',String(ratio),'important');}
  });
  await inspect(page,label,{screenshot:true});
  await page.evaluate(()=>{for(const {e,style} of window.auditFontStyles){if(style===null)e.removeAttribute('style');else e.setAttribute('style',style);}delete window.auditFontStyles;});
}
try{
  for(const [index,[width,height]] of sizes.entries()){
    const coarse=width<=700 || (width<=1000&&height<=500),id=`${width}x${height}`;
    const page=await browser.newPage({viewport:{width,height},hasTouch:coarse,isMobile:coarse,deviceScaleFactor:width===412?3:1});
    try{
      await boot(page);await inspect(page,`${id}-entry`,{screenshot:width===320&&height===568});
      await page.locator('#place-button').click();await inspect(page,`${id}-city`);
      await page.locator('[data-action="home"]').click();
      if([375,768,1280].includes(width))await page.locator('#difficulty-select').selectOption('hard');
      // Hold a local file so the otherwise fleeting loading layout is reviewable.
      let pending;
      const hold=route=>{pending=route;};
      await page.route('**/data/practice.json',hold);
      await page.evaluate(()=>{window.auditStart=window.qaTools.start_practice_round.execute({});});
      await page.locator('.loading').waitFor();await inspect(page,`${id}-loading`);
      await pending.continue();await page.evaluate(()=>window.auditStart);await page.unroute('**/data/practice.json',hold);
      await inspect(page,`${id}-first`);
      const input=page.locator('#destination-input');await input.click();await input.fill('Portland');await page.locator('#destination-results:not([hidden])').waitFor();
      await inspect(page,`${id}-search`,{screenshot:height===300||width===701});
      await input.press('ArrowDown');await input.press('Enter');
      const chosen=await input.inputValue();
      await page.locator('[data-action="clue"]').click();
      if(await input.inputValue()!==chosen)issues.push({label:id,kind:'paid reveal lost selected city'});
      await inspect(page,`${id}-paid`);
      if(await page.locator('#clue-book-toggle').isVisible()){
        const before=await tool(page,'read_game_state');await page.locator('#clue-book-toggle').click();
        const after=await tool(page,'read_game_state');if(before.guessesLeft!==after.guessesLeft)issues.push({label:id,kind:'collapse consumed guess'});
        await inspect(page,`${id}-collapsed`);
      }
      await page.locator('#guess-button').click();await inspect(page,`${id}-first-miss`);
      const first=await page.locator('.book-clue').filter({hasText:'Distance & direction'}).textContent();
      if([320,390,701,1440].includes(width)){
        if(await page.locator('#clue-book-toggle').isVisible())await page.locator('#clue-book-toggle').click();
        const before=await tool(page,'read_game_state'),closed=await page.locator('#clue-book-content').isHidden();
        await page.locator('#guess-button').click();
        if(await page.locator('#input-message').textContent()!=='Choose a city or airport first.')issues.push({label:id,kind:'invalid guess message missing'});
        await input.fill('Portland');await input.press('ArrowDown');await input.press('Enter');await page.locator('#guess-button').click();
        if(!(await page.locator('#input-message').textContent()).includes('already tried'))issues.push({label:id,kind:'duplicate guess message missing'});
        const after=await tool(page,'read_game_state');
        if(before.guessesLeft!==after.guessesLeft || closed!==await page.locator('#clue-book-content').isHidden())issues.push({label:id,kind:'invalid/duplicate altered attempts or book choice'});
        await inspect(page,`${id}-validation`);
      }
      await submit(page,'LHR');await submit(page,'HND');await page.locator('[data-action="clue"]').click();
      const after=await page.locator('.book-clue').filter({hasText:'Distance & direction'}).textContent();
      if(first!==after)issues.push({label:id,kind:'first-city clue changed'});
      if(await page.locator('.book-clue').count()!==6)issues.push({label:id,kind:'revealed clue count mismatch'});
      await inspect(page,`${id}-all-clues`,{screenshot:[320,390,701,1440,2560].includes(width)&&height!==300});
      if(await page.locator('#clue-book-toggle').isVisible()){await page.locator('#clue-book-toggle').click();await inspect(page,`${id}-all-collapsed`,{screenshot:width===390&&height===844});}
      await submit(page,'KIJ');await inspect(page,`${id}-win`,{screenshot:width===320&&height===568});
      await page.locator('#help-button').click();await inspect(page,`${id}-help`,{screenshot:width===390&&height===450});await page.locator('#close-info').click();
      await page.locator('#data-button').click();await inspect(page,`${id}-data`);await page.locator('#info-done').click();
      await page.locator('#difficulty-select').selectOption('hard');await page.locator('[data-action="next"]').click();
      await page.locator('#destination-input').waitFor();await inspect(page,`${id}-replay`);
      if((await tool(page,'read_game_state')).difficulty!=='hard')issues.push({label:id,kind:'replay difficulty not applied'});
      for(const query of ['Portland','LHR','CDG','JFK','MEL','SIN'])await submit(page,query);
      if((await tool(page,'read_game_state')).status!=='lost')issues.push({label:id,kind:'six-miss round did not finish'});
      await inspect(page,`${id}-loss`,{screenshot:width===390&&height===844});
      await page.locator('[data-action="home"]').click();await inspect(page,`${id}-return`);
      checks.push({size:id,result:'completed'});
    }catch(error){issues.push({label:id,kind:'interaction failure',message:error.message});}
    await page.close();
    if((index+1)%5===0)console.log(JSON.stringify({phase,completed:index+1,total:sizes.length,issues:issues.length}));
  }
  for(const [width,height] of [[320,568],[390,844],[701,900],[1024,768]]){
    const page=await browser.newPage({viewport:{width,height}});await boot(page);
    await textZoom(page,`${width}-text200-entry`);
    await tool(page,'start_practice_round');await submit(page,'LHR');
    while(await page.locator('[data-action="clue"]').count())await page.locator('[data-action="clue"]').click();
    await textZoom(page,`${width}-text200-clues`);
    await submit(page,'KIJ');await textZoom(page,`${width}-text200-result`);
    await page.locator('#help-button').click();await textZoom(page,`${width}-text200-dialog`);await page.close();
  }
  const long=structuredClone(recordings[0]);
  long.route.airline.name='InternationalAirline'.repeat(7);
  long.route.destination.name='LongDestinationAirportName'.repeat(10);
  long.route.origin.name='LongOriginAirportName'.repeat(13);
  for(const [width,height] of [[320,568],[701,900],[1440,900]]){
    const page=await browser.newPage({viewport:{width,height}});await boot(page,{fixture:long});await tool(page,'start_practice_round');await submit(page,'LHR');
    while(await page.locator('[data-action="clue"]').count())await page.locator('[data-action="clue"]').click();
    if(await page.locator('.book-clue').count()!==6)issues.push({label:`${width}-long-clues`,kind:'long valid airline fixture omitted'});
    await inspect(page,`${width}-long-clues`);await submit(page,'KIJ');await inspect(page,`${width}-long-result`,{screenshot:width===320});await page.close();
  }
  const rotate=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await boot(rotate);await tool(rotate,'start_practice_round');await rotate.locator('#clue-book-toggle').click();
  await rotate.setViewportSize({width:844,height:390});await inspect(rotate,'phone-rotated',{screenshot:true});
  if(await rotate.locator('#clue-book-content').isVisible())issues.push({label:'phone-rotated',kind:'rotation lost collapsed choice'});
  await rotate.setViewportSize({width:390,height:844});await inspect(rotate,'phone-portrait-restored');await rotate.close();
  const resize=await browser.newPage({viewport:{width:390,height:844}});await boot(resize);await tool(resize,'start_practice_round');
  await resize.locator('#clue-book-toggle').focus();await resize.locator('#clue-book-toggle').press('Space');await inspect(resize,'keyboard-collapsed');
  await resize.locator('#clue-book-toggle').press('Enter');
  if(await resize.locator('#clue-book-content').isHidden())issues.push({label:'keyboard-toggle',kind:'Enter failed to open book'});
  await resize.locator('#clue-book-toggle').press('Space');
  await resize.setViewportSize({width:1440,height:900});await inspect(resize,'resize-to-desktop');
  if(await resize.locator('#clue-book-content').isHidden())issues.push({label:'resize-to-desktop',kind:'desktop retained collapsed book'});
  await resize.setViewportSize({width:390,height:844});await inspect(resize,'resize-back-to-phone');
  if(await resize.locator('#clue-book-content').isVisible())issues.push({label:'resize-back-to-phone',kind:'resize lost phone choice'});
  await resize.locator('#clue-book-toggle').press('Enter');await submit(resize,'KIJ');await inspect(resize,'early-win');await resize.close();
  const contrast=await browser.newPage({viewport:{width:320,height:568},forcedColors:'active',reducedMotion:'reduce'});await boot(contrast);await tool(contrast,'start_practice_round');
  await contrast.locator('#destination-input').click();await contrast.locator('#destination-input').fill('San');await inspect(contrast,'forced-colors-search',{screenshot:true});
  await contrast.locator('#destination-input').press('Escape');await contrast.locator('#clue-book-toggle').click();await inspect(contrast,'forced-colors-collapsed');await contrast.close();
  for(const [width,height] of [[320,568],[390,300],[1440,900]]){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});await boot(page);
    let pending;await page.route('**/data/practice.json',route=>{pending=route;});
    await page.evaluate(()=>{window.auditStart=window.qaTools.start_practice_round.execute({});});await page.locator('.loading').waitFor();
    await textZoom(page,`${width}-text200-loading`);await page.locator('[data-action="cancel"]').click();
    await pending.continue();await page.evaluate(()=>window.auditStart);await inspect(page,`${width}-cancelled-loading`);
    if((await tool(page,'read_game_state')).view!=='entry')issues.push({label:`${width}-cancelled-loading`,kind:'late load replaced cancelled view'});
    await page.close();
  }
  for(const [width,height] of [[320,568],[390,300],[1440,900]]){
    const page=await browser.newPage({viewport:{width,height},forcedColors:width===320?'active':'none',reducedMotion:'reduce'});await boot(page,{brokenData:true});
    await tool(page,'start_practice_round');await inspect(page,`${width}-error`);await textZoom(page,`${width}-text200-error`);
    await page.locator('#help-button').click();await inspect(page,`${width}-error-dialog`);await page.close();
  }
  const summary={phase,engine:await browser.version(),resolutions:sizes.length,views:views.length,issues,errors,checks,viewsDetail:views};
  await writeFile(resolve(out,'audit.json'),JSON.stringify(summary,null,2));
  const kinds={};for(const issue of issues)kinds[issue.kind]=(kinds[issue.kind]||0)+1;
  console.log(JSON.stringify({phase,resolutions:sizes.length,views:views.length,issueCount:issues.length,kinds,errors,output:out,samples:issues.slice(0,16)},null,2));
  if(phase==='final' && (issues.length||errors.length))process.exitCode=1;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
