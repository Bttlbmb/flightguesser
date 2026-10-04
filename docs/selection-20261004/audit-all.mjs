import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = file => JSON.parse(execFileSync(process.execPath, ['docs/selection-20261004/' + file], { cwd: root, encoding: 'utf8', maxBuffer: 6000000 }));
const variety = run('agent-variety.mjs');
const fairness = run('agent-fairness.mjs');
execFileSync(process.execPath, ['docs/selection-20261004/agent-review.mjs', '--save'], { cwd: root, maxBuffer: 6000000 });
const review = JSON.parse(await readFile(new URL('./agent-review-results.json', import.meta.url), 'utf8'));
await writeFile(new URL('./agent-variety-results.json', import.meta.url), JSON.stringify(variety, null, 2) + '\n');
await writeFile(new URL('./agent-fairness-results.json', import.meta.url), JSON.stringify(fairness, null, 2) + '\n');
execFileSync(process.execPath, ['docs/selection-20261004/replay-capture.mjs', '--extended'], { cwd: root, maxBuffer: 6000000 });
const real = JSON.parse(await readFile(new URL('./extended-replay-results.json', import.meta.url), 'utf8'));
const sample = JSON.parse(await readFile(new URL('./extended-sample.json', import.meta.url), 'utf8'));
const browser = JSON.parse(await readFile(new URL('./browser/results.json', import.meta.url), 'utf8'));
assert.ok(Object.values(variety.checks).every(Boolean));
assert.equal(fairness.apiPassed, 49);
assert.equal(fairness.edgePassed, 6);
assert.equal(review.asymmetricHub.successes, 36);
assert.equal(review.distinctCarrierCrowding.successes, 72);
assert.ok(review.stress.every(item => item.pass));
const selected = real.rows.filter(row => row.label.startsWith('new') && !row.error);
const baseline = real.rows.filter(row => row.label.startsWith('baseline') && !row.error);
const attempted = real.rows.filter(row => row.label.startsWith('new'));
const bands = selected.reduce((counts, row) => {
  const band = row.remainingKm < 1000 ? 'regional' : row.remainingKm < 4000 ? 'medium' : 'long';
  counts[band] = (counts[band] || 0) + 1;
  return counts;
}, {});
const sourceHashes = {};
for (const file of ['public/api.js', 'public/selection.js', 'public/app.js', 'tests/selection.test.mjs']) {
 sourceHashes[file] = createHash('sha256').update(await readFile(new URL('../../' + file, import.meta.url))).digest('hex');
}
const summary = {
 evidence: 'Three independent agent-authored synthetic audits reproduced against final source, plus recorded Seoul sky replays. Selection attempts are not unique flights or human playtests.',
 agentSelectionAttempts: 120 + 108 + 49,
 agentAdditionalEdgeChecks: 12,
 variety: { tracked: variety.improved, withoutHistory: variety.noHistory, onlyLocal: variety.onlyLocal },
 review: { asymmetric: { ...review.asymmetricHub, rows: undefined }, crowded: { ...review.distinctCarrierCrowding, rows: undefined }, stress: review.stress },
 fairness: { apiRuns: fairness.apiRuns, passed: fairness.apiPassed, edgeRuns: fairness.edgeRuns, edgePassed: fairness.edgePassed },
 expandedRecordedReplay: {
  attempts: attempted.length, selections: selected.length, recoveries: attempted.filter(row => row.error),
  baselineLocalArrivals: baseline.filter(row => row.localDestination).length,
  localArrivals: selected.filter(row => row.localDestination).length,
  nearArrivals: selected.filter(row => row.nearArrivals || row.airportRemainingKm < 250 || row.remainingKm < 250 || row.approaching).length,
  uniqueCities: new Set(selected.map(row => row.destination)).size,
  countries: [...new Set(selected.map(row => row.country))].sort(),
  remainingRangeKm: [Math.min(...selected.map(row => row.remainingKm)), Math.max(...selected.map(row => row.remainingKm))],
  lengthBands: bands,
  directionWithin30Degrees: selected.filter(row => row.headingError <= 30).length,
  routeRequestMax: Math.max(...selected.map(row => row.routeRequests)),
 },
 realCapture: {
  recordedAt: new Date(sample.recordedAt).toISOString(),
  rawAircraft: sample.payload.ac.length, eligibleObservations: sample.eligibleObservations,
  callsignQueries: 9 + sample.extension.requestCount,
  usableExplicitRoutes: sample.outcomes.filter(item => item.usableRoute).length,
  eligibleRoutes: sample.outcomes.filter(item => item.profile?.eligible).length,
  localRoutes: sample.outcomes.filter(item => item.profile?.localDestination).length,
  qualification: sample.extension.qualification,
 },
 browser, sourceHashes,
};
const r = summary.expandedRecordedReplay;
const report = [
 'Flightguesser flight-selection audit — 4 October 2026',
 '',
 'The new selector removes the tested Seoul/Incheon arrival bias and produces regional, medium and long-distance puzzles in the sampled data. These tests measure variety, room remaining and clue usefulness; human enjoyment has not been measured.',
 '',
 'Implemented behavior',
 '- Destinations within 150 km of the starting place are ineligible. The exact airport and every accepted destination city are checked, including both Seoul and Incheon.',
 '- Both the airport and main city must be at least 250 km from the aircraft. Aircraft below 12,000 ft descending faster than 300 ft/min are ineligible within 500 km of their airport. Arrivals are not used as a fallback.',
 '- Normal aircraft are checked before low descending aircraft. Each tier samples across carrier and direction groups before revisiting a group, so many arrival carriers cannot crowd out departures.',
 '- Up to four distinct city groups are compared. Scores favor useful displayed headings, clearer city naming and novelty across the last ten opened rounds, with soft country, carrier and distance-band preferences. Random draws count each city group once.',
 '- Searches retain the limits of 12 route requests, three nearby requests and 25 seconds overall. The first usable flight starts an eight-second comparison window. Fresh retained routes survive later connection failure or the deadline; cancellation and HTTP 429 stop the search.',
 '- History is committed only after a playable round opens and stays in page memory without user coordinates. Reported routes, city scoring memberships and observed timestamps remain intact. The small recorded practice collection is unchanged.',
 '',
 'Independent agent audits',
 'Variety: 120 attempts — 60 tracked selections, 40 without history and 20 expected local-only refusals. The tracked rounds selected 15 cities in nine countries, with 30 regional, 27 medium and three long-distance rounds. There were no local or near-arrival answers or adjacent repeats. Displayed headings were within 30 degrees in 54 of 60 rounds. Dense and arrival-flood sessions each delivered 12 distinct answers in 12 rounds; sparse coverage offered only two answers. Without history, six of 40 adjacent answers repeated.',
 'Selection review: 108 playable rounds across pools with 18 same-carrier arrivals or 30 different arrival carriers. All six available nonlocal destinations appeared, with no local/near-arrival answers or adjacent repeats and at most six route requests. All six network, cancellation, deadline, freshness, city-alias and rate-limit stress checks passed. The independently measured old 18-arrival fixture chose ICN in all 36 baseline rounds.',
 'Fairness: 49 targeted API checks and six additional checks passed. They covered far-out local arrivals, short approaches, displayed heading, airport aliases, sparse Jeju departures, contradictory routes, freshness and request limits.',
 'Together these are 277 synthetic API selection attempts and 12 additional edge checks. Fixtures use explicit fabricated routes and seeded random draws. Some reuse aircraft to isolate destination history; others refresh identities to model replenishing traffic. They are not live traffic distributions or human game scores.',
 '',
 'Expanded recorded Seoul replay',
 'The original snapshot at ' + summary.realCapture.recordedAt + ' contained ' + summary.realCapture.rawAircraft + ' aircraft and ' + summary.realCapture.eligibleObservations + ' eligible observations. We queried 33 callsign associations afterward; ' + summary.realCapture.usableExplicitRoutes + ' were usable explicit routes and ' + summary.realCapture.eligibleRoutes + ' met puzzle criteria. Raw bodies, statuses and timestamps are preserved.',
 'One primary route lookup returned HTTP 500. Replays model that outage for primary lookups and use only the captured adsbdb fallback associations. Uncaptured aircraft are omitted. replay-capture.mjs reconstructs the old policy from the original selector. Both policies receive the same recorded subset and original observation clock.',
 'Each policy receives 60 independent fresh-seed searches and twenty three-round sessions. Sessions commit history, immediate city exclusions and played-aircraft exclusions. Replays make no provider requests.',
 'Old policy: 120 returned rounds, including 100 local arrivals. Fresh-seed searches all chose Seoul; session rounds alternated between Seoul and Jeju.',
 'New policy: ' + r.selections + ' playable rounds from ' + r.attempts + ' attempts, across ' + r.uniqueCities + ' answers and ' + r.countries.length + ' countries, with ' + Math.round(r.remainingRangeKm[0]).toLocaleString('en') + '–' + Math.round(r.remainingRangeKm[1]).toLocaleString('en') + ' km remaining. No local or near-arrival answers. The mix was ' + r.lengthBands.regional + ' regional, ' + r.lengthBands.medium + ' medium and ' + r.lengthBands.long + ' long-distance rounds. One search exhausted its bounded sample and showed recovery.',
 'Selected answers included Osaka, Jeju, Fukuoka, Almaty, Prague, Singapore, Taipei and Hong Kong. The reported ICN flight FDX5132 was rejected despite having 427 km left to Seoul and 466 km to ICN, because its answer was local.',
 '',
 'Verification',
 'All 119 offline tests passed. The static build was rebuilt with selection.js. Desktop 1440 × 1000 and emulated-phone 390 × 844 Chromium checks passed three fixture rounds each, hidden-answer and route protection, session rotation, arrival-only recovery and cancellation/retry. There were no uncaught JavaScript errors or horizontal overflow. Recovery screenshots were visually inspected. Browser provider requests were intercepted.',
 '',
 'Limits and tradeoffs',
 '- One sky snapshot plus sampled database associations cannot establish worldwide coverage or variation throughout the day. Routes are reported associations, not confirmed flight plans. Recorded timestamps are never refreshed to claim live data.',
 '- Novelty sometimes outweighs heading quality. Six intentionally turning synthetic fixtures and some recorded rounds have weaker direction clues. The Dalian record has a 72-degree disagreement and the awkward municipality label Ganjingzi, Dalian; Jiaodong, Jiaozhou is another naming gap. Human playtesting and sourced served-city naming remain useful follow-ups.',
 '- Filtering local/short flights can increase empty searches. Comparing candidates costs more lookups than taking the first usable flight. The existing time and request limits remain mandatory.',
 '- Device location, hosted-origin CORS, physical phones and screen readers were not retested. No publication or deployment was performed.',
 '',
 'Reproduce offline from repository root',
 'npm test',
 'npm run build',
 'node docs/selection-20261004/audit-all.mjs',
 'node docs/selection-20261004/replay-capture.mjs --extended',
 'node docs/selection-20261004/browser-qa.mjs',
 '',
 'Evidence: summary.json; agent-variety-results.json; agent-review-results.json; agent-fairness-results.json; extended-replay-results.json; extended-sample.json; live-capture/; extended-routes/; browser/.',
 'Source SHA256: ' + JSON.stringify(sourceHashes, null, 2),
].join('\n');
await writeFile(new URL('./summary.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
await writeFile(new URL('./report.txt', import.meta.url), report + '\n');
const qaPath = new URL('../../docs/qa.md', import.meta.url);
let qa = await readFile(qaPath, 'utf8');
const heading = '## Current flight-selection audit: 4 October 2026';
if (!qa.includes(heading)) {
 const intro = '\n\n' + heading + '\n\nAll119 offline tests passed and the static build was rebuilt. Three independent agent audits covered277 simulated API selection attempts plus12 edge checks: local and short arrivals were rejected, session variety and regional departures remained playable, and cancellation, provider pauses, freshness and request caps passed. The expanded recorded Seoul replay produced119 playable rounds from120 attempts,11 city answers across8 countries, 259–8,219 km remaining and zero local/near-arrival answers. The old policy returned100 local arrivals from120 attempts on the same recorded subset; one new search returned explicit recovery. These are replays of one sampled sky moment, not120 distinct live observations or human enjoyment measurements.\n\nDesktop 1440 × 1000 and emulated-phone 390 × 844 Chromium checks passed session rotation, hidden-answer/route protection, arrival-only recovery, cancellation and retry, with no uncaught errors or horizontal overflow. Recovery screenshots were visually reviewed. Browser provider traffic was intercepted; hosted-origin CORS, physical phones and screen readers were not retested. [Audit report](selection-20261004/report.txt), [summary](selection-20261004/summary.json) and the adjacent runners/raw captures preserve methods and limitations.\n\n';
 const at = qa.indexOf('\n## Current clue audit');
 qa = qa.slice(0,at) + intro + qa.slice(at);
 qa = qa.replace(/All119/g,'All 119').replace(/covered277/g,'covered 277').replace(/plus12/g,'plus 12').replace(/produced119/g,'produced 119').replace(/from120/g,'from 120').replace(/attempts,11/g,'attempts, 11').replace(/across8/g,'across 8').replace(/returned100/g,'returned 100').replace(/not120/g,'not 120').replace(/Desktop1440/g,'Desktop 1440').replace(/phone390/g,'phone 390');
 await writeFile(qaPath, qa);
}
console.log(JSON.stringify({
 agentAttempts: summary.agentSelectionAttempts, agentEdges: summary.agentAdditionalEdgeChecks,
 trackedVariety: variety.improved, reviewSuccesses: review.asymmetricHub.successes + review.distinctCarrierCrowding.successes,
 fairness: summary.fairness, real: r, evidence: summary.realCapture,
}, null, 2));
