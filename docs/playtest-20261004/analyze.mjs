import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createGame, submitGuess, revealClue, MAX_GUESSES } from '../../public/game.js';
import { indexCities, searchCities, cityLabel, destinationRepeatIds } from '../../public/destinations.js';
import { mergeRouteAirports, countryName } from '../../public/airports.js';
import { distanceKm, bearingDegrees, compassPoint } from '../../public/geo.js';

const raw = JSON.parse(await readFile(new URL('./rounds.json', import.meta.url), 'utf8'));
const root = new URL('../../', import.meta.url);
const airports = JSON.parse(await readFile(new URL('public/data/airports.json', root), 'utf8'));
const practice = JSON.parse(await readFile(new URL('public/data/practice.json', root), 'utf8'));
const cities = indexCities(airports);
const records = raw.players.flatMap(p => p.rounds.map(r => ({ player: p.player, ...r })));
assert.equal(raw.players.length, 5);
assert.equal(records.length, 100);
assert(records.every(r => ['won','lost'].includes(r.status)));
const currentHashes = Object.fromEntries(await Promise.all(Object.keys(raw.metadata.sourceHashes).map(async path => [path, createHash('sha256').update(await readFile(new URL(path, root))).digest('hex')])));
assert.deepEqual(currentHashes, raw.metadata.sourceHashes, 'Gameplay source or data changed during playtest');
let replayActions = 0;
let privacyStatesChecked = 0;
const summaryErrors = [];
for (const player of raw.players) {
  assert.equal(player.rounds.length, 20);
  assert.equal(player.completed, 20);
  let practiceIndex = 0;
  let lastIds = new Set();
  for (const record of player.rounds) {
    let round;
    if (record.phase === 'shipped-practice') {
      const i = Array.from({length:practice.length},(_,k)=>(practiceIndex+k)%practice.length).find(i=>!destinationRepeatIds(practice[i].route.destination).some(id=>lastIds.has(id)));
      assert.notEqual(i, undefined);
      round = structuredClone(practice[i]); practiceIndex = (i + 1) % practice.length;
    } else {
      round = structuredClone(raw.metadata.fixtures.find(f=>f.number===record.number).round);
    }
    const game = createGame(round);
    const ci = indexCities(mergeRouteAirports(airports, round.route));
    lastIds = new Set(destinationRepeatIds(round.route.destination, game.destination));
    assert.equal(record.initialState.clues.length, 1);
    assert.equal(record.initialState.guessesLeft, MAX_GUESSES);
    for (const action of record.actions) {
      assert.equal(game.status, 'playing');
      assert.equal(action.before.guessesLeft, MAX_GUESSES-game.guesses.length);
      assert.equal(action.before.clues.length, game.clueIndex+1);
      assert(!Object.hasOwn(action.before, 'destinationCity'));
      assert(!Object.hasOwn(action.before, 'acceptedCities'));
      assert(!Object.hasOwn(action.before, 'airport'));
      privacyStatesChecked++;
      assert(action.reason.length>0 && action.source.length>0);
      assert.equal(typeof action.confidence, 'number');
      if (action.action === 'clue') assert(revealClue(game));
      else {
        const city = ci.find(c=>c.id===action.cityId);
        assert(city);
        const result = submitGuess(game,city);
        assert(result.accepted);
        assert.equal(result.guess.correct,action.correct);
      }
      assert.equal(game.status,action.after.status);
      assert.equal(MAX_GUESSES-game.guesses.length, action.after.guessesLeft);
      const expectedClues = game.status==='playing' ? game.clues.slice(0,game.clueIndex+1) : game.clues;
      assert.equal(expectedClues.length,action.after.clues.length);
      expectedClues.forEach((clue,i)=>{
        assert.equal(clue.kind==='direction'?'First clue':clue.title,action.after.clues[i].title);
        if(clue.kind!=='direction') assert.equal(clue.value,action.after.clues[i].value);
      });
      if(game.status==='playing') {
        assert(!Object.hasOwn(action.after,'destinationCity'));
        assert(!Object.hasOwn(action.after,'acceptedCities'));
        privacyStatesChecked++;
      }
      replayActions++;
    }
    assert.equal(game.status,record.status);
    assert.equal(game.guesses.length,record.attemptsUsed);
    assert.equal(game.assistance,record.paidClues);
    assert.equal(game.guesses.filter(g=>g.city).length,record.cityGuesses);
    assert.equal(game.round.route.destination.code,record.answer.airportCode);
    assert.equal(cityLabel(game.destination.primary),record.answer.city);
    assert.equal(game.clues.filter(c=>c.title==='Distance & direction').length,game.guesses.some(g=>g.city&&!g.correct)?1:0);
    assert.equal(record.actions.filter(a=>a.correct).length,game.status==='won'?1:0);
  }
}
const total = list=>list.reduce((n,r)=>n+r.attemptsUsed,0);
const stats = list=>({
  rounds:list.length,wins:list.filter(r=>r.status==='won').length,losses:list.filter(r=>r.status==='lost').length,
  attempts:total(list),meanAttempts:+(total(list)/list.length).toFixed(2),
  cityGuesses:list.reduce((n,r)=>n+r.cityGuesses,0),paidReveals:list.reduce((n,r)=>n+r.paidClues,0),
  firstSlotWins:list.filter(r=>r.status==='won'&&r.attemptsUsed===1).length,
  winsWithinTwoSlots:list.filter(r=>r.status==='won'&&r.attemptsUsed<=2).length,
});
const fresh = records.filter(r=>r.number<=3||r.number>=11);
const repeats = records.filter(r=>r.number>=4&&r.number<=10);
const phase = name=>stats(records.filter(r=>r.phase===name));
const playerMetrics = raw.players.map(p=>({
  player:p.player,
  all:stats(p.rounds),practice:stats(p.rounds.filter(r=>r.phase==='shipped-practice')),
  controlled:stats(p.rounds.filter(r=>r.phase==='controlled-fixture')),
  coldPractice:stats(p.rounds.filter(r=>r.number<=3)),
  repeats:stats(p.rounds.filter(r=>r.number>=4&&r.number<=10)),
}));
const directions = {north:'N',northeast:'NE',east:'E',southeast:'SE',south:'S',southwest:'SW',west:'W',northwest:'NW'};
const information = [];
for (const record of records) {
  const firstMiss = record.actions.find(a=>a.action==='guess'&&!a.correct);
  if(!firstMiss) continue;
  const clue=firstMiss.after.clues.find(c=>c.title==='Distance & direction');
  const m=clue.value.match(/^([\d,]+) km · (\w+)$/);
  if(!m) { summaryErrors.push({player:record.player,round:record.number,issue:'Unparsed small distance'});continue; }
  const ref=cities.find(c=>c.id===firstMiss.cityId), targetKm=Number(m[1].replaceAll(',','')), sector=directions[m[2]];
  assert(ref);
  const exact=cities.filter(c=>Math.round(distanceKm(ref,c))===targetKm&&compassPoint(bearingDegrees(ref,c))===sector);
  const approximate=cities.filter(c=>Math.abs(distanceKm(ref,c)-targetKm)<=50&&compassPoint(bearingDegrees(ref,c))===sector);
  information.push({
    player:record.player,round:record.number,reference:cityLabel(ref),distanceKm:targetKm,sector,
    exactCandidateCount:exact.length,exactCandidates:exact.map(c=>({id:c.id,label:cityLabel(c),country:c.country})),
    candidatesWithin50Km:approximate.length,answer:record.answer.city,
  });
}
const median = values=>{const v=[...values].sort((a,b)=>a-b);return v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;};
const precision = {examinedFirstMisses:information.length,uniqueExactCandidates:information.filter(x=>x.exactCandidateCount===1).length,medianExactCandidateCount:median(information.map(x=>x.exactCandidateCount)),medianCandidatesWithin50Km:median(information.map(x=>x.candidatesWithin50Km)),cityIndexSize:cities.length,measure:'All bundled city objects matching the rounded integer-km distance and 45-degree compass sector from the actual first wrong city. Exact-coordinate enumeration is a diagnostic upper bound; no player agent had this data.'};
const scenarioMetrics = [1,2,3,11,12,13,14,15,16,17,18,19,20].map(number=>{
  const rows=records.filter(r=>r.number===number);
  return {number,phase:rows[0].phase,city:rows[0].answer.city,category:rows[0].category,...stats(rows),attemptsByPlayer:Object.fromEntries(rows.map(r=>[r.player,r.attemptsUsed]))};
});
const pickerQueries=['Portland','Manila','Athens','Krakow','Marrakech','Marrakesh','Madeira','Japan N','Poland B','Greece S'];
const pickerDiagnostics = pickerQueries.map(query=>{const m=searchCities(cities,query);return {query,total:m.total,shown:m.map(c=>({id:c.id,city:cityLabel(c),country:c.country,airport:c.airportName??null}))};});
const loss=records.find(r=>r.player==='casual'&&r.number===13);
const intendedCity=searchCities(cities,'PDX')[0];
assert.equal(loss.status,'lost');
assert.equal(loss.actions.at(-1).city,'Portland, Maine');
const counterGame=createGame(raw.metadata.fixtures.find(f=>f.number===13).round);
const counterIndex=indexCities(mergeRouteAirports(airports,counterGame.round.route));
for(const [i,action]of loss.actions.entries()){
  if(action.action==='clue')assert(revealClue(counterGame));
  else assert(submitGuess(counterGame,i===loss.actions.length-1?intendedCity:counterIndex.find(c=>c.id===action.cityId)).accepted);
}
assert.equal(counterGame.status,'won');
const paidCheck=createGame(practice[0]);
submitGuess(paidCheck,searchCities(cities,'Tokyo')[0]);
const paidPath=structuredClone(paidCheck),guessPath=structuredClone(paidCheck);
revealClue(paidPath);submitGuess(guessPath,searchCities(cities,'Seoul')[0]);
const paidNext=paidPath.clues[paidPath.clueIndex],guessNext=guessPath.clues[guessPath.clueIndex];
assert.deepEqual(paidNext,guessNext);assert.equal(paidPath.guesses.length,guessPath.guesses.length);
const summary = {
  generatedAt:new Date().toISOString(),methodology:raw.metadata.methodology,
  all:stats(records),practice:phase('shipped-practice'),controlled:phase('controlled-fixture'),
  fresh:stats(fresh),repeats:stats(repeats),
  exactMemoryReplayWins:repeats.filter(r=>r.status==='won'&&r.attemptsUsed===1&&r.actions[0].source.includes('memory')).length,
  players:playerMetrics,scenarios:scenarioMetrics,precision,firstMissDiagnostics:information,
  pickerDiagnostics,validation:{replayedRounds:100,replayedAcceptedActions:replayActions,privacyStatesChecked,sourceHashesUnchanged:true,all101ExistingTestsPassed:true,browserSpotCheck:'Unmodified current app in Codex in-app browser: practice start, city search, first miss, later miss, three paid reveals, country and initial with one slot left, sixth-slot win and preserved history. This extra QA round is excluded from the100 scored rounds.',summaryErrors},
  paidRevealCounterfactual:{afterFirstMiss:true,sameNextClue:paidNext.title,sameCostSlots:paidPath.guesses.length,interpretation:'After first miss, a nonterminal further wrong city guess unlocks the same fact as a paid reveal, while adding a chance to win or eliminate a city. Before the first city, a paid reveal follows a different fact order, so global dominance is not claimed.'},
  lossCounterfactual:{player:'casual',round:13,original:'lost',intendedFinalCity:'Portland, Oregon',selectedFinalCity:'Portland, Maine',replaceOnlyFinalSelection:counterGame.status,slots:counterGame.guesses.length,interpretation:'Selection error after correct destination inference; no original score changed.'},
  annotationCorrections:[{player:'analytical',round:1,action:1,originalSource:'heading|initial',correctedInterpretation:'heading only',reason:'Agent reported a source-label error after finishing; no city-initial clue was present in the saved visible state. Original log is preserved.'}],
  limitations:[
    'Independent LLM roles share the same underlying model and general knowledge; persona constraints do not establish human novice or expert performance.',
    '100 completed rounds include repeated practice observations and the same ten handcrafted fixtures across players, rather than100 independent or unique routes.',
    '50 shipped practice rounds and50 synthetic rule-test rounds. No current live-provider destination, geographic distribution or availability was measured.',
    'Players used a text-only adapter importing current rules/search unchanged. They did not visually interpret the globe or use mouse/touch controls.',
    'The query convenience action selects a displayed picker choice, defaulting to choice0; actual UI requires explicit selection. First-row homonym mistakes may be amplified by this adapter. Country, region and airport labels remain visible and correct.',
    'Ten controlled fixtures are small, deliberately selected cases with nine airline names and familiar destination regions; they cannot estimate worldwide or human win rates.',
    'Exact coordinate candidate enumeration is an analysis tool only, unavailable to the blind agents. One city object is not necessarily one physically distinct municipality.',
    'Decision reasons, source labels and confidence values are self-reports, not causal experiments or calibrated probabilities. The analytical agent corrected its first source annotation from heading plus initial to heading only; the saved state proves no initial was visible and the original annotation remains in the log.',
  ],
};
const labels={casual:'Casual city knowledge',geography:'Geography enthusiast',aviation:'Aviation enthusiast',cautious:'Cautious clue first',analytical:'Competitive puzzle solver'};
const lines=[
'Flightguesser assessment from100 agent rounds',
'',
'The tested game was easy for knowledgeable agents, highly repetitive in shipped practice, and occasionally awkward because city-picker identities differ from familiar served-city names. It supported deduction; the observed wins do not justify calling it mainly a lottery. The overall win rate is strongly inflated by practice memory and a favorable small fixture set.',
'',
'Scope and method',
'',
'Five independent agent sessions played20 rounds each: ten shipped practice rounds followed by ten labeled synthetic fixtures. Each agent made sequential decisions from currently visible clues, ordinary search results and its own completed-round memory. No agent could read source, city coordinates, hidden answers, other sessions or external flight sites. The adapter imported the current game and city search without changing them. The agents represent strategy roles, not measured human populations.',
'',
'The100 scored rounds split into50 recorded-practice plays and50 simulated-flight plays. The practice rotation visits three recordings with three answers. Seven replay rounds per player repeat those same openings. The ten fixtures cover Tokyo, Dubai, Portland Oregon, Balice for Krakow airport, Funchal, Manila Pasay, Spata-Artemida for Athens airport, Melbourne without airline metadata, a short Paris arrival and Vancouver on a long great-circle route. These are fabricated observations for current-rule testing, not verified flights or schedules. In total there are13 distinct destination answers.',
'',
'Observed results',
'',
'Player | practice wins | fixture wins | mean fixture attempts | paid reveals in all20',
...playerMetrics.map(p=>labels[p.player]+' | '+p.practice.wins+'/10 | '+p.controlled.wins+'/10 | '+p.controlled.meanAttempts.toFixed(2)+' | '+p.all.paidReveals),
'',
'All scored rounds: '+summary.all.wins+'/100 wins, '+summary.all.meanAttempts.toFixed(2)+' attempts per round.',
'Recorded practice: '+summary.practice.wins+'/50 wins. Simulated fixtures: '+summary.controlled.wins+'/50 wins.',
'Fresh answer exposures, excluding the35 practice replays: '+summary.fresh.wins+'/65 wins; '+summary.fresh.meanAttempts.toFixed(2)+' attempts per round.',
'Practice replays: '+summary.repeats.wins+'/35 wins; '+summary.exactMemoryReplayWins+' explicit first-slot memory wins.',
'Attempt means count both paid reveals and city submissions, and include six-slot losses. They do not measure human time.',
'',
'Difficulty and luck',
'',
'The geography and competitive roles solved most fresh fixtures quickly. This is evidence of a low challenge ceiling for these agents on this set. The cautious role spent more slots buying certainty; comparing its attempts with a guess-first role demonstrates strategic cost in these sessions, not a causal human experiment.',
'',
'Initial direction supports several plausible cities and some immediate wins were educated gambles. The strongest example of skill is the recurring ability to use one distance-and-direction result to name the next city:258 km north of Tokyo suggested Niigata;208 km south of Seattle suggested Portland; roughly1,460 km southwest of Madrid suggested Funchal. Airline knowledge sometimes helped, but Alaska suggested the wrong Seattle hub and LOT suggested the wrong Warsaw hub. It is a useful prior rather than an answer.',
'',
'The first-miss precision analysis found a single matching bundled city object in '+precision.uniqueExactCandidates+' of '+precision.examinedFirstMisses+' examined first misses. The median exact candidate count was '+precision.medianExactCandidateCount+'; with a 50 km tolerance the median was '+precision.medianCandidatesWithin50Km+' candidates with a50 km distance tolerance. This used the whole '+precision.cityIndexSize+'-city coordinate index. It demonstrates how much information the integer-km clue carries and how easily an automated solver could narrow it, not what an ordinary person can do mentally.',
'',
'The casual player lost the Portland fixture. Its final reason correctly identified the Pacific Northwest Portland, but the default first result selected Portland Maine. Replaying exactly the same preceding actions and changing only that final selected city wins on slot six. The original recorded loss remains a loss. This was selection friction, not failed destination deduction.',
'',
'Repetition',
'',
'Four recordings are bundled, but two answer Seoul. With the current deterministic rotation and adjacent-repeat exclusion, all five sessions cycled Niigata, Jeju City and Seoul. The later Seoul recording was continually skipped. All35 replay openings were recognized and solved in one slot. Avoiding only the immediately previous answer does not preserve challenge once this pool is learned.',
'',
'City names and the picker',
'',
'Krakow search successfully finds Balice through the airport name, and Athens search finds Spata-Artemida. The game nevertheless displays and initials those municipalities, B and S, rather than the expected familiar cities K and A. Manila becomes Manila Pasay. This raises the value of airport and picker knowledge relative to ordinary city geography.',
'',
'Portland Maine appears before Oregon; a small US Manila appears before Philippine Manila; two US Athens options precede the Greek airport municipality. Region, country and airport labels are available, so careful selection works. The adapter defaulting to the first displayed choice exaggerates the risk compared with attentive UI selection. These findings establish ranking and naming friction, not a broken scoring rule.',
'',
'Clue progression and choices',
'',
'Only the first wrong city gets geographic feedback. Later wrong cities reveal the next flight fact without a fresh distance or direction. This makes the first guess strategically important, but later guesses cannot refine a geographic hypothesis in the same way. For strong agents the first clue solved the round before airline, remaining distance, country or initial became relevant. For a struggling player the country normally arrives after four misses and the initial after five, leaving two and one city slots respectively.',
'',
'After a first city miss, a paid reveal and a further nonterminal wrong city guess have the same slot cost and reveal the same next fact. A city guess also offers a chance to win and excludes an answer. Paying then has little strategic advantage. Before the first city, paid clues can reach airline, distance and country sooner because the reference-city clue has not been inserted; the cautious strategy therefore has a real early information tradeoff.',
'',
'Near-arrival cases can be very easy once the remaining-distance fact appears, while initially misleading headings can send guesses away from the named starting city. The game already prefers at least250 km remaining for live selection; the short Paris fixture deliberately tests its fallback boundary. Removing an optional airline also moves country and initial earlier, so missing metadata does not consistently make a round harder.',
'',
'Recommended priorities',
'',
'1. Expand the dated real practice corpus to dozens of destination cities and avoid answers across a longer recent history. This addresses the strongest observed problem before changing the guess budget. The pool-size suggestion is a design target, not a tested optimum.',
'2. Add sourced served-city mappings for common gaps such as Krakow and Athens, retaining municipalities as explicit alternatives. Derive initials from accepted familiar cities. Improve homonym ranking and make chosen region/country prominent; use only query intent and already revealed facts for context, never the hidden answer.',
'3. Give later turns a meaningful choice, for example which flight clue to unlock. Consider a separate score or assistance cost for manual reveals, or another benefit that makes them worth their slot after a miss. Preserve the deliberate fixed-reference rule unless a later redesign changes it.',
'4. Keep a forgiving normal mode while testing a separate harder mode with coarser distance bands or less decisive early clues. Simply cutting guesses would mostly penalize unfamiliar names and cautious players. These alternatives were not implemented or empirically compared here.',
'5. Validate the revised flow with real novice and experienced people and a fresh, geographically broad route sample. Record replay familiarity separately from fresh solves, and count picker mistakes separately from deduction failures.',
'',
'Fresh scenario breakdown',
'',
'Round | answer | wins out of5 | mean attempts | attempts by player in casual geography aviation cautious analytical order',
...scenarioMetrics.map(s=>s.number+' | '+s.city+' | '+s.wins+'/5 | '+s.meanAttempts.toFixed(2)+' | '+raw.players.map(p=>s.attemptsByPlayer[p.player]).join(' ')),
'',
'Verification and evidence',
'',
'All100 logs were replayed against current core functions; '+replayActions+' accepted actions and '+privacyStatesChecked+' playing-state snapshots passed the state/privacy checks. All101 existing offline tests passed. The source/data hashes match their pretest values. A separate current-browser practice round verified the first miss, unchanged reference clue on later misses, paid reveals, final-country/initial timing, sixth-slot win and preserved history. That QA round is not part of the100.',
'',
'Files: rounds.json preserves every accepted decision and visible before/after state; summary.json contains computed metrics, precision and picker diagnostics, a selection-error counterfactual, source verification and limitations; harness.mjs and analyze.mjs reproduce the local setup and analysis.',
'',
'Limits',
'',
...summary.limitations.map((s,i)=>(i+1)+'. '+s),
'',
'The game source was not changed. The findings concern this local version and these agent strategies; reliable live play, broader route difficulty, actual human enjoyment, phone controls and screen-reader behavior were not established.',
'',
];
await writeFile(new URL('./summary.json', import.meta.url), JSON.stringify(summary,null,2));
await writeFile(new URL('./report.txt', import.meta.url), lines.join('\n').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/([;:])(?=\d)/g, '$1 '));
console.log(JSON.stringify({all:summary.all,practice:summary.practice,controlled:summary.controlled,fresh:summary.fresh,repeats:summary.repeats,players:summary.players,precision:summary.precision,validation:summary.validation,files:['report.txt','summary.json','rounds.json']},null,2));
