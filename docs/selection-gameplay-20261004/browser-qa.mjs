import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGameServer } from '../../scripts/serve.mjs';
import { aircraftCandidates, normalizeRoute } from '../../public/flights.js';
import { mergeRouteAirports } from '../../public/airports.js';
const require=createRequire('/Users/maxnurnus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json');
const {chromium}=require('playwright');
const records=JSON.parse(await readFile(new URL('./rounds.json',import.meta.url),'utf8'));
assert(records.players.every(p=>p.completed===36));
const sample=JSON.parse(await readFile(new URL('../selection-20261004/extended-sample.json',import.meta.url),'utf8'));
const airports=JSON.parse(await readFile(new URL('../../public/data/airports.json',import.meta.url),'utf8'));
const aircraft=aircraftCandidates(sample.payload,sample.place,250,sample.recordedAt);
function recordedRound(row) {
  const a=aircraft.find(a=>a.callsign===row.callsign),captured=sample.routes[row.callsign];
  const route=normalizeRoute(captured.raw,a,captured.provider);
  const merged=mergeRouteAirports(airports,route);
  const endpoint=e=>e?{...e,city:merged.find(a=>a.id===e.id)?.city??e.city}:e;
  return {mode:'practice',aircraft:a,route:{...route,origin:endpoint(route.origin),destination:endpoint(route.destination)},place:sample.place,recordedAt:sample.recordedAt,provider:'adsb.lol'};
}
const selected=[];
for(const difficulty of ['normal','hard']) {
  const geography=records.players.find(p=>p.player===`geography-${difficulty}`);
  const aviation=records.players.find(p=>p.player===`aviation-${difficulty}`);
  const cautious=records.players.find(p=>p.player===`cluefirst-${difficulty}`);
  selected.push({player:geography.player,record:geography.rounds.find(r=>r.policy==='baseline'&&r.answer.city==='Seoul')});
  selected.push({player:aviation.player,record:aviation.rounds.find(r=>r.policy==='new'&&r.answer.city==='Ganjingzi, Dalian')});
  selected.push({player:cautious.player,record:cautious.rounds.find(r=>r.policy==='new'&&r.answer.city==='Prague')});
}
const output=new URL('./browser/',import.meta.url);await mkdir(output,{recursive:true});
const server=createGameServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'/Users/maxnurnus/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const errors=[],cases=[];
const tool=(page,name,args={})=>page.evaluate(({name,args})=>window.qaTools[name].execute(args),{name,args});
async function check(page,expected) {
  const actual=await tool(page,'read_game_state');
  assert.equal(actual.status,expected.status);assert.equal(actual.guessesLeft,expected.guessesLeft);
  assert.equal(actual.difficulty,expected.difficulty);assert.equal(actual.clues.length,expected.clues.length);
  for(const [i,c]of expected.clues.entries()) {
    if(c.value) {assert(actual.clues[i].includes(c.title));assert(actual.clues[i].includes(c.value));}
    else assert(actual.clues[i].includes(`${c.heading}°`));
  }
  if(actual.status==='playing') {
    for(const field of ['destinationCity','acceptedCities','reportedAirport','diagnostics','selection'])assert(!(field in actual));
    assert.equal(await page.locator('.globe-route').count(),0);
  } else assert.equal(actual.destinationCity,expected.destinationCity);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  return actual;
}
try {
  for(const [width,height]of [[1440,1000],[390,844]])for(const [i,item]of selected.entries()) {
    const {record:r,player}=item,round=recordedRound(r.selection);
    const page=await browser.newPage({viewport:{width,height},isMobile:width<700,hasTouch:width<700});
    const external=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.qaTools={};Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool(t){window.qaTools[t.name]=t;}}});});
    await page.route('**/*',route=> {
      const u=new URL(route.request().url());
      if(u.origin!==base){external.push(u.hostname);return route.abort();}
      if(u.pathname==='/data/practice.json')return route.fulfill({json:[round]});
      if(u.pathname==='/api/config')return route.fulfill({json:{relay:false}});
      if(u.pathname.startsWith('/api/'))return route.abort();
      return route.continue();
    });
    await page.goto(base);await page.waitForFunction(()=>window.qaTools.start_practice_round);
    await tool(page,'set_difficulty',{difficulty:r.difficulty});
    await tool(page,'start_practice_round');await check(page,r.initialState);
    const stem=`${width}-${player}-${i}`;
    await page.screenshot({path:new URL(`${stem}-opening.png`,output).pathname,fullPage:true});
    for(const [j,a]of r.actions.entries()) {
      await check(page,a.before);
      if(a.action==='clue')await tool(page,'reveal_next_clue');
      else {
        const choices=await tool(page,'search_cities',{query:a.city});
        assert(choices.cities.some(c=>c.id===a.cityId),`Explicit intended picker city unavailable: ${a.city}`);
        await tool(page,'submit_city_guess',{cityId:a.cityId});
      }
      await check(page,a.after);
      if(j===r.actions.length-2)await page.screenshot({path:new URL(`${stem}-last-clues.png`,output).pathname,fullPage:true});
    }
    await page.screenshot({path:new URL(`${stem}-finished.png`,output).pathname,fullPage:true});
    assert.deepEqual(external,[]);
    cases.push({width,height,player,number:r.number,policy:r.policy,difficulty:r.difficulty,answer:r.answer.city,actions:r.actions.length,status:r.status});
    await page.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(new URL('./results.json',output),JSON.stringify({qualification:'Twelve browser playbacks of six selected completed agent rounds at desktop and emulated phone widths. Original captured records supplied through intercepted practice JSON; unchanged application game/picker/clues. No live calls, current-sky or physical-phone claim.',cases,errors},null,2)+'\n');
  console.log(JSON.stringify({cases:cases.length,errors},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
