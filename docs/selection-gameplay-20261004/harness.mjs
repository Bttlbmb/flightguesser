import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createGame, submitGuess, revealClue, MAX_GUESSES } from '../../public/game.js';
import { indexCities, searchCities, cityLabel } from '../../public/destinations.js';
import { countryName, mergeRouteAirports } from '../../public/airports.js';
import { aircraftCandidates, normalizeRoute } from '../../public/flights.js';

const root = new URL('../../', import.meta.url);
const airports = JSON.parse(await readFile(new URL('public/data/airports.json', root), 'utf8'));
const sample = JSON.parse(await readFile(new URL('../selection-20261004/extended-sample.json', import.meta.url), 'utf8'));
const replay = JSON.parse(await readFile(new URL('../selection-20261004/extended-replay-results.json', import.meta.url), 'utf8'));
const seeds = [900, 901, 904, 906, 907, 919];
const profiles = ['geography', 'aviation', 'cluefirst'];
const difficulties = ['normal', 'hard'];
const sourcePaths = ['public/game.js','public/destinations.js','public/airports.js','public/geo.js','public/flights.js','public/selection.js','public/app.js','public/data/city-links.js','public/data/airports.json'];
const metadata = {
  startedAt: new Date().toISOString(), recordedAt: sample.recordedAt, seeds,
  method: 'Six fresh blind agent contexts: three strategies in each current difficulty. Each plays 36 rounds, alternating six recorded three-round sessions from old and new selection. Selection policy and answers hidden while playing. Same policy/session observations and role-specific order in both difficulties. Only visible clues and current city-picker search; no source, coordinates, external lookups or other sessions. A text adapter omits visual globe interpretation. Sequences reset selector history between three-round blocks as in the original replay, but player memory persists throughout its 36 rounds.',
  selection: 'Chosen six sessions deliberately cover all eleven new-selector answer cities, including awkward names and a weak heading. This is a coverage sample, not an unbiased estimate of live traffic. Both policies use the exact same chosen seeds; old sessions contain Seoul/Jeju/Seoul. No provider requests; original observation timestamps are retained.',
  sourceHashes: Object.fromEntries(await Promise.all(sourcePaths.map(async p => [p, createHash('sha256').update(await readFile(new URL(p,root))).digest('hex')]))),
  replayHash: createHash('sha256').update(await readFile(new URL('../selection-20261004/extended-replay-results.json',import.meta.url))).digest('hex'),
};
const originalNow = Date.now;
Date.now = () => sample.recordedAt;
const aircraft = aircraftCandidates(sample.payload, sample.place, 250);
const rounds = new Map();
for (const row of replay.rows.filter(r => /session$/.test(r.label) && seeds.includes(r.seed) && !r.error)) {
  const a = aircraft.find(a => a.callsign === row.callsign);
  assert(a, row.callsign);
  const captured = sample.routes[row.callsign];
  const route = normalizeRoute(captured.raw,a,captured.provider);
  assert(route);
  const merged = mergeRouteAirports(airports,route);
  const endpoint = e => e ? {...e,city:merged.find(a => a.id===e.id)?.city??e.city}:e;
  const round = { mode:'practice', aircraft:a, route:{...route,origin:endpoint(route.origin),destination:endpoint(route.destination)}, place:sample.place, recordedAt:sample.recordedAt, provider:'adsb.lol' };
  rounds.set(`${row.label}:${row.run}`,{row,round});
}
Date.now = originalNow;
const sessions = new Map();
for (const [roleIndex,profile] of profiles.entries()) for (const difficulty of difficulties) {
  const plan = [];
  for (const [i,seed] of seeds.entries()) {
    const oldFirst = roleIndex===0 || (roleIndex===2 && i%2===0);
    for (const policy of oldFirst ? ['baseline','new'] : ['new','baseline']) {
      for(const row of replay.rows.filter(r => r.label===`${policy}-session` && r.seed===seed)) {
        assert(!row.error);
        plan.push({key:`${row.label}:${row.run}`,policy,difficulty,seed});
      }
    }
  }
  assert.equal(plan.length,36);
  const id=`${profile}-${difficulty}`;
  sessions.set(id,{id,profile,difficulty,plan,position:-1,game:null,index:null,records:[],current:null});
}
const plain = c => c.kind==='direction' ? {title:c.title,heading:Math.round(c.heading)%360,direction:c.direction,detail:c.detail}
  : {title:c.title,value:c.value,detail:c.detail};
function visible(s) {
  if(!s.game) return {player:s.id,status:'ready',totalRounds:36,difficulty:s.difficulty};
  const g=s.game;
  return {player:s.id,roundNumber:s.position+1,totalRounds:36,difficulty:g.difficulty,status:g.status,startingCity:g.round.place.name,
    mapDescription:'Recorded aircraft near Seoul. The visual globe is not reproduced in this text adapter. No route or destination is visible while playing.',
    guessesLeft:MAX_GUESSES-g.guesses.length,cluesRemaining:Math.max(0,g.clues.length-1-g.clueIndex),
    clues:(g.status==='playing'?g.clues.slice(0,g.clueIndex+1):g.clues).map(plain),
    history:g.guesses.map(q=>({...q.kind==='clue'?{action:'clue'}:{action:'guess',city:cityLabel(q.city),country:countryName(q.city.country),correct:q.correct},...Number.isInteger(q.clueIndex)?{revealedClue:plain(g.clues[q.clueIndex])}:{}})),
    ...g.status==='playing'?{}:{destinationCity:cityLabel(g.destination.primary),acceptedCities:g.destination.accepted.map(cityLabel),country:countryName(g.round.route.destination.country),airport:g.round.route.destination.name+' ('+g.round.route.destination.code+')',callsign:g.round.aircraft.callsign},
  };
}
function finalize(s) {
  const r=s.current,g=s.game;
  Object.assign(r,{status:g.status,attemptsUsed:g.guesses.length,paidClues:g.assistance,cityGuesses:g.guesses.filter(q=>q.city).length});
  if(g.status!=='playing') Object.assign(r,{answer:{city:cityLabel(g.destination.primary),accepted:g.destination.accepted.map(cityLabel),country:g.round.route.destination.country,airport:g.round.route.destination.code},finalState:visible(s)});
}
function next(s) {
  if(s.game?.status==='playing') throw Error('Finish this round before next.');
  if(s.position===35) return {player:s.id,status:'complete',completed:36};
  const entry=s.plan[++s.position], fixture=rounds.get(entry.key);
  s.game=createGame(structuredClone(fixture.round),{difficulty:s.difficulty});
  s.index=indexCities(mergeRouteAirports(airports,s.game.round.route));
  s.current={number:s.position+1,...entry,selection:fixture.row,status:'playing',actions:[],initialState:visible(s)};
  s.records.push(s.current);finalize(s);return visible(s);
}
function search(s,query) {
  if(!s.index) throw Error('Start a round.');
  const found=searchCities(s.index,query);
  return {query,total:found.total,cities:found.map((c,i)=>({choice:i,id:c.id,city:cityLabel(c),country:countryName(c.country),countryCode:c.country,...c.fallback?{airport:c.airportName,airportCode:c.airportCode}:{}}))};
}
function action(s,input) {
  if(s.game?.status!=='playing') throw Error('Start a playing round.');
  if(!['guess','clue'].includes(input.action)) throw Error('Use guess or clue.');
  if(!input.reason || !input.source || typeof input.confidence!=='number') throw Error('Record reason, source and confidence.');
  const record={action:input.action,reason:String(input.reason).slice(0,1800),source:String(input.source).slice(0,200),confidence:input.confidence,before:visible(s)};
  if(input.action==='clue') {if(!revealClue(s.game)) throw Error('No next clue.');}
  else {
    if(typeof input.cityId!=='string') throw Error('Search and explicitly choose cityId before guessing.');
    const c=s.index.find(c=>c.id===input.cityId);
    if(!c) throw Error('City ID unavailable.');
    const result=submitGuess(s.game,c);if(!result.accepted) throw Error(result.reason);
    Object.assign(record,{cityId:c.id,city:cityLabel(c),correct:result.guess.correct});
  }
  record.after=visible(s);s.current.actions.push(record);finalize(s);return record.after;
}
async function persist() {
  await writeFile(new URL('./rounds.json',import.meta.url),JSON.stringify({metadata,updatedAt:new Date().toISOString(),players:[...sessions.values()].map(s=>({player:s.id,profile:s.profile,difficulty:s.difficulty,completed:s.records.filter(r=>r.status!=='playing').length,rounds:s.records}))},null,2)+'\n');
}
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/audit/status') return send(res,200,[...sessions.values()].map(s=>({player:s.id,completed:s.records.filter(r=>r.status!=='playing').length,status:s.game?.status??'ready'})));
    const [,play,id,endpoint]=url.pathname.split('/');
    const s=sessions.get(id);if(play!=='play'||!s) return send(res,404,{error:'Unknown player.'});
    if(req.method==='GET'&&endpoint==='state') return send(res,200,visible(s));
    if(req.method==='GET'&&endpoint==='search') return send(res,200,search(s,url.searchParams.get('q')??''));
    if(req.method!=='POST')return send(res,405,{error:'POST action required.'});
    let body='';for await(const chunk of req){body+=chunk;if(body.length>8000)throw Error('Body too large.');}
    const input=body?JSON.parse(body):{};
    let result;
    if(endpoint==='next')result=next(s);
    else if(endpoint==='action')result=action(s,input);
    else if(endpoint==='feedback') {
      if(!s.current||s.game.status==='playing')throw Error('Finish first.');
      s.current.feedback={difficulty:input.difficulty,interest:input.interest,frustration:input.frustration,note:String(input.note??'').slice(0,1600)};
      result={saved:true};
    } else throw Error('Unknown endpoint.');
    await persist();send(res,200,result);
  } catch(error){send(res,400,{error:error.message});}
});
await persist();
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,players:[...sessions.keys()],plannedRounds:216})));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
