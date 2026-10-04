import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createGame, submitGuess, revealClue, MAX_GUESSES, formatClueDistance } from '../../public/game.js';
import { indexCities, cityLabel } from '../../public/destinations.js';
import { mergeRouteAirports } from '../../public/airports.js';
import { aircraftCandidates, normalizeRoute } from '../../public/flights.js';
import { distanceKm, bearingDegrees, compassPoint } from '../../public/geo.js';
const root=new URL('../../',import.meta.url);
const data=JSON.parse(await readFile(new URL('./rounds.json',import.meta.url),'utf8'));
const sample=JSON.parse(await readFile(new URL('../selection-20261004/extended-sample.json',import.meta.url),'utf8'));
const replay=JSON.parse(await readFile(new URL('../selection-20261004/extended-replay-results.json',import.meta.url),'utf8'));
const airports=JSON.parse(await readFile(new URL('public/data/airports.json',root),'utf8'));
const hashes=Object.fromEntries(await Promise.all(Object.keys(data.metadata.sourceHashes).map(async p=>[p,createHash('sha256').update(await readFile(new URL(p,root))).digest('hex')])));
assert.deepEqual(hashes,data.metadata.sourceHashes,'Source changed during replay');
assert.equal(createHash('sha256').update(await readFile(new URL('../selection-20261004/extended-replay-results.json',import.meta.url))).digest('hex'),data.metadata.replayHash);
assert.equal(data.players.length,6);
assert(data.players.every(p=>p.completed===36),'All 216 rounds must be completed');
const aircraft=aircraftCandidates(sample.payload,sample.place,250,sample.recordedAt);
function loadRound(row) {
  const a=aircraft.find(a=>a.callsign===row.callsign),captured=sample.routes[row.callsign];
  const route=normalizeRoute(captured.raw,a,captured.provider);
  assert(route);
  const merged=mergeRouteAirports(airports,route);
  const endpoint=e=>e?{...e,city:merged.find(a=>a.id===e.id)?.city??e.city}:e;
  return {mode:'practice',aircraft:a,route:{...route,origin:endpoint(route.origin),destination:endpoint(route.destination)},place:sample.place,recordedAt:sample.recordedAt,provider:'adsb.lol'};
}
const plain=c=>c.kind==='direction'?{title:c.title,heading:Math.round(c.heading)%360,direction:c.direction,detail:c.detail}:{title:c.title,value:c.value,detail:c.detail};
let actionsChecked=0,privacyStates=0;
const records=[],precision=[];
for(const p of data.players) {
  const seenAnswers=new Set(),seenOpenings=new Set(),seenFlights=new Set();
  for(const r of p.rounds) {
    const round=loadRound(r.selection),g=createGame(round,{difficulty:p.difficulty});
    const cities=indexCities(mergeRouteAirports(airports,round.route));
    const answerKey=`${r.answer.country}:${r.answer.city}`;
    const signature=JSON.stringify(r.initialState.clues);
    const newAnswer=!seenAnswers.has(answerKey),newOpening=!seenOpenings.has(signature);
    const newRecordedFlight=!seenFlights.has(r.selection.callsign);
    seenAnswers.add(answerKey);seenOpenings.add(signature);seenFlights.add(r.selection.callsign);
    const validate=state=> {
      assert.equal(state.status,g.status);
      assert.equal(state.guessesLeft,MAX_GUESSES-g.guesses.length);
      assert.deepEqual(state.clues,(g.status==='playing'?g.clues.slice(0,g.clueIndex+1):g.clues).map(plain));
      if(g.status==='playing') {
        for(const forbidden of ['destinationCity','acceptedCities','country','airport','callsign','selection','diagnostics','round']) assert(!Object.hasOwn(state,forbidden));
        privacyStates++;
      }
    };
    validate(r.initialState);
    for(const a of r.actions) {
      validate(a.before);assert.equal(g.status,'playing');
      if(a.action==='clue')assert(revealClue(g));
      else {
        const city=cities.find(c=>c.id===a.cityId);assert(city);
        const first=!g.guesses.some(q=>q.city);
        const result=submitGuess(g,city);assert(result.accepted);assert.equal(result.guess.correct,a.correct);
        if(first&&!a.correct) {
          const target=distanceKm(city,g.destination.primary),sector=compassPoint(bearingDegrees(city,g.destination.primary));
          const countryKnown=a.before.clues.some(c=>c.title==='Destination country');
          const pool=countryKnown?cities.filter(c=>c.country===round.route.destination.country):cities;
          const options=pool.map(c=>({c,d:distanceKm(city,c),sector:compassPoint(bearingDegrees(city,c))}));
          const count=difficulty=>options.filter(o=>o.sector===sector&&formatClueDistance(o.d,difficulty)===formatClueDistance(target,difficulty)).length;
          precision.push({player:p.player,policy:r.policy,number:r.number,answer:r.answer.city,reference:cityLabel(city),countryKnown,normalCandidates:count('normal'),hardCandidates:count('hard'),mode:p.difficulty});
        }
      }
      validate(a.after);actionsChecked++;
    }
    assert.equal(g.status,r.status);assert.equal(g.guesses.length,r.attemptsUsed);assert.equal(g.assistance,r.paidClues);
    assert.equal(cityLabel(g.destination.primary),r.answer.city);
    assert.equal(g.clues.filter(c=>c.title==='Distance & direction').length,g.guesses.some(q=>q.city&&!q.correct)?1:0);
    records.push({player:p.player,profile:p.profile,difficulty:p.difficulty,...r,newAnswer,newOpening,newRecordedFlight,memoryFirstSlotWin:r.status==='won'&&r.attemptsUsed===1&&r.actions[0].source.includes('memory')});
  }
}
const median=v=>{const s=[...v].sort((a,b)=>a-b);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:null;};
const mean=v=>v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2):null;
const stats=list=>({rounds:list.length,wins:list.filter(r=>r.status==='won').length,losses:list.filter(r=>r.status==='lost').length,meanSlots:mean(list.map(r=>r.attemptsUsed)),medianSlots:median(list.map(r=>r.attemptsUsed)),firstSlotWins:list.filter(r=>r.status==='won'&&r.attemptsUsed===1).length,withinTwoSlots:list.filter(r=>r.status==='won'&&r.attemptsUsed<=2).length,fiveOrSixSlots:list.filter(r=>r.attemptsUsed>=5).length,paidClues:list.reduce((n,r)=>n+r.paidClues,0),memoryFirstSlotWins:list.filter(r=>r.memoryFirstSlotWin).length,difficultyRating:mean(list.map(r=>r.feedback?.difficulty).filter(Number.isFinite)),interestRating:mean(list.map(r=>r.feedback?.interest).filter(Number.isFinite)),frustrationRating:mean(list.map(r=>r.feedback?.frustration).filter(Number.isFinite))});
function variety(rows) {
  const selected=rows.filter(r=>!r.error),counts={};
  for(const r of selected)counts[r.destination]=(counts[r.destination]||0)+1;
  const proportions=Object.values(counts).map(n=>n/selected.length);
  const entropy=-proportions.reduce((n,p)=>n+p*Math.log2(p),0);
  const blocks=new Map();for(const r of selected){if(!blocks.has(r.seed))blocks.set(r.seed,[]);blocks.get(r.seed).push(r);}
  const bands={regional:0,medium:0,long:0};for(const r of selected)bands[r.remainingKm<1000?'regional':r.remainingKm<4000?'medium':'long']++;
  return {attempts:rows.length,selected:selected.length,uniqueAnswers:Object.keys(counts).length,countriesRegions:[...new Set(selected.map(r=>r.country))],destinationCounts:counts,topAnswerShare:+Math.max(...proportions).toFixed(3),entropyBits:+entropy.toFixed(3),effectiveEquallyLikelyAnswers:+(2**entropy).toFixed(2),meanDistinctPerThreeRoundSession:mean([...blocks.values()].map(b=>new Set(b.map(r=>r.destination)).size)),sessionsWithAllDifferent:[...blocks.values()].filter(b=>b.length===3&&new Set(b.map(r=>r.destination)).size===3).length,numberOfSessions:blocks.size,bands,localArrivals:selected.filter(r=>r.localDestination).length,headingWithin30:selected.filter(r=>r.headingError<=30).length,weakHeadingOver45:selected.filter(r=>r.headingError>45).length};
}
const byCell={};
for(const policy of ['baseline','new'])for(const mode of ['normal','hard']) {
  const list=records.filter(r=>r.policy===policy&&r.difficulty===mode);
  byCell[`${policy}-${mode}`]={all:stats(list),freshAnswers:stats(list.filter(r=>r.newAnswer)),freshOpenings:stats(list.filter(r=>r.newOpening)),freshRecordedFlights:stats(list.filter(r=>r.newRecordedFlight)),repeatAnswers:stats(list.filter(r=>!r.newAnswer))};
}
const perPlayer=data.players.map(p=>({player:p.player,baseline:stats(records.filter(r=>r.player===p.player&&r.policy==='baseline')),new:stats(records.filter(r=>r.player===p.player&&r.policy==='new'))}));
const perDestination=[...new Set(records.map(r=>r.answer.city))].map(city=>({city,normal:stats(records.filter(r=>r.answer.city===city&&r.difficulty==='normal')),hard:stats(records.filter(r=>r.answer.city===city&&r.difficulty==='hard')),fresh:stats(records.filter(r=>r.answer.city===city&&r.newAnswer)),notes:records.filter(r=>r.answer.city===city&&r.feedback?.note).map(r=>({player:r.player,number:r.number,note:r.feedback.note}))}));
let browser=null;try{browser=JSON.parse(await readFile(new URL('./browser/results.json',import.meta.url),'utf8'));}catch{}
const summary={generatedAt:new Date().toISOString(),method:data.metadata.method,selectionCoverage:data.metadata.selection,validation:{rounds:records.length,actionsChecked,privacyStates,sourceHashesUnchanged:true,replayHashUnchanged:true,distinctRecordedAircraft:new Set(records.map(r=>r.selection.callsign)).size,distinctVisibleOpenings:new Set(records.map(r=>JSON.stringify(r.initialState.clues))).size,browser},all:stats(records),cells:byCell,players:perPlayer,destinations:perDestination,
  selectedPlaytestSessions:Object.fromEntries(['baseline','new'].map(p=>[p,variety(replay.rows.filter(r=>r.label===`${p}-session`&&data.metadata.seeds.includes(r.seed)))])),
  fullRecordedSessions:Object.fromEntries(['baseline','new'].map(p=>[p,variety(replay.rows.filter(r=>r.label===`${p}-session`))])),
  precision:{firstMisses:precision.length,normalMedianCandidates:median(precision.map(r=>r.normalCandidates)),hardMedianCandidates:median(precision.map(r=>r.hardCandidates)),normalUnique:precision.filter(r=>r.normalCandidates===1).length,hardUnique:precision.filter(r=>r.hardCandidates===1).length,note:'Diagnostic enumeration of indexed city objects consistent with the actual first-reference clue. Same reference cities analyzed under both distance formats, plus destination country only when already visible. Automated solver upper bound; unavailable to blind players.'},firstMissDiagnostics:precision,
  losses:records.filter(r=>r.status==='lost').map(r=>({player:r.player,number:r.number,policy:r.policy,answer:r.answer,actions:r.actions,feedback:r.feedback})),
  limitations:['One recorded Seoul sky moment and sampled explicit route associations; no current live-provider coverage or human win rate.','Six LLM agents share an underlying model. Roles change strategies; they do not establish novice/expert population performance.','Six three-round sessions deliberately cover all eleven available new-selector answers. Harder or rarer cities are overrepresented relative to the full selector replay.','Counterbalanced old/new order and fresh separate contexts for Normal/Hard. Memory within each 36-round context still accelerates repeated answers and shared Jeju exposures. Fresh answer and opening scores are separated.','Selector history resets between recorded three-round blocks, matching saved replay. Player memory persists. These are not thirty-six continuously updating live sky observations.','Text adapter omits visual globe interpretation, mouse/touch interactions and latency. Browser playback separately verifies selected decisions and visible clue flow.','Difficulty/interest/frustration ratings are subjective agent judgments, not calibrated human enjoyment measures.','Exact candidate counts enumerate city objects with known coordinates as an analysis upper bound; agents had neither coordinates nor index access.']};
await writeFile(new URL('./summary.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
const interpretation=[
'The selector substantially improves destination variety and removes tested local-arrival bias. Aggregate slot use rises as answer repetition falls. Fresh puzzles remain forgiving for these knowledgeable agent roles.',
`New selection: Normal ${byCell['new-normal'].all.meanSlots} slots overall and ${byCell['new-normal'].freshAnswers.meanSlots} on first answer exposures; Hard ${byCell['new-hard'].all.meanSlots} overall and ${byCell['new-hard'].freshAnswers.meanSlots} on first answer exposures. Slots include paid clues. ${stats(records.filter(r=>r.policy==='new')).wins} of ${stats(records.filter(r=>r.policy==='new')).rounds} new-selector rounds won.`,
'All six sessions reuse one sky snapshot. Their later memory wins cannot establish live-game challenge, and fresh old-selector exposures cover only Seoul and Jeju.',
'Country arrives early in the current game. Czechia strongly narrows Prague; Singapore and Hong Kong region clues nearly supply their city answers. Airline information usually arrives after knowledgeable players have solved the puzzle.',
'The weakest selected case was Dalian: a substantially divergent heading plus Ganjingzi/Dalian naming made it harder through ambiguity and picker knowledge. Qingdao also displays Jiaodong, Jiaozhou with J rather than the expected familiar-city initial. These are more promising improvement targets than reducing the six-slot budget.',
'Hard ranges retain more candidate cities than precise distances, but this is an information diagnostic rather than a human difficulty estimate. Fresh contexts, coverage sampling and small role counts prevent a calibrated mode difficulty claim.',
'Priority follow-ups: sourced familiar served-city mappings for Qingdao/Dalian, broader dated recordings and sky samples, then novice and experienced human testing. Do not infer worldwide variety or an optimal guess budget from this single capture.',
];
const lines=['Flightguesser gameplay replay — 4 October 2026','',...interpretation,'','Scope and method','',data.metadata.method,'',data.metadata.selection,'','Matched current-rule results (slots include paid reveals and losses)','Policy / difficulty | rounds | wins | mean slots | fresh-answer rounds/wins/mean slots | first-slot memory wins'];
for(const [key,c]of Object.entries(byCell))lines.push(`${key} | ${c.all.rounds} | ${c.all.wins} | ${c.all.meanSlots} | ${c.freshAnswers.rounds}/${c.freshAnswers.wins}/${c.freshAnswers.meanSlots} | ${c.all.memoryFirstSlotWins}`);
lines.push('','Agent strategy results','Player | old mean slots / wins | new mean slots / wins');
for(const p of perPlayer)lines.push(`${p.player} | ${p.baseline.meanSlots} / ${p.baseline.wins} | ${p.new.meanSlots} / ${p.new.wins}`);
lines.push('','Repetition and variety','The full twenty three-round sessions are used for distribution estimates; the six selected playtest sessions intentionally cover all eleven answer cities.');
for(const [policy,v]of Object.entries(summary.fullRecordedSessions))lines.push(`${policy}: ${v.selected}/${v.attempts} playable; ${v.uniqueAnswers} cities, ${v.countriesRegions.length} countries/regions; top answer share ${Math.round(v.topAnswerShare*100)}%; effective equally likely answers ${v.effectiveEquallyLikelyAnswers}; mean ${v.meanDistinctPerThreeRoundSession} distinct answers per three-round session; ${v.sessionsWithAllDifferent}/${v.numberOfSessions} full sessions with all answers different; remaining-distance bands ${JSON.stringify(v.bands)}; ${v.localArrivals} local answers; ${v.weakHeadingOver45} headings over 45 degrees from destination.`);
lines.push('','Destination-level fresh exposure difficulty','Answer | fresh rounds | wins | mean slots');
for(const d of perDestination)lines.push(`${d.city} | ${d.fresh.rounds} | ${d.fresh.wins} | ${d.fresh.meanSlots}`);
lines.push('','Clue precision',`${precision.length} actual first misses: median matching city objects ${summary.precision.normalMedianCandidates} with precise Normal distance and ${summary.precision.hardMedianCandidates} with Hard ranges. Unique Normal matches ${summary.precision.normalUnique}; unique Hard matches ${summary.precision.hardUnique}. ${summary.precision.note}`,'','Verification',`${records.length} completed logs (${summary.validation.distinctRecordedAircraft} captured aircraft and ${summary.validation.distinctVisibleOpenings} initial text clue signatures) replayed against unchanged current game/search; ${actionsChecked} accepted actions, ${privacyStates} hidden-answer states checked. Source and selection-replay hashes unchanged.`,browser?`Browser playback: ${browser.cases.length} cases, ${browser.errors.length} uncaught errors.`:'Browser playback not yet attached.','119 current offline tests passed.','',...summary.limitations.map((s,i)=>`${i+1}. ${s}`),'','Evidence: rounds.json; summary.json; harness.mjs; analyze.mjs; browser/.','');
await writeFile(new URL('./report.txt',import.meta.url),lines.join('\n'));
console.log(JSON.stringify({all:summary.all,cells:summary.cells,variety:summary.fullRecordedSessions,precision:summary.precision,losses:summary.losses.map(r=>({player:r.player,number:r.number,answer:r.answer.city}))},null,2));
