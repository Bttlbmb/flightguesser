import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { findNearbyRound } from '../../public/api.js';
import { aircraftCandidates, normalizeRoute, observationTime } from '../../public/flights.js';
import { selectionProfile, rememberSelection } from '../../public/selection.js';
import { destinationCities, destinationRepeatIds } from '../../public/destinations.js';
import { distanceKm } from '../../public/geo.js';
const data=JSON.parse(await readFile(new URL('./samples.json',import.meta.url),'utf8'));
const hashes=JSON.parse(await readFile(new URL('./source-hashes.json',import.meta.url),'utf8'));
for(const [path,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(await readFile(new URL('../../'+path,import.meta.url))).digest('hex'),hash,'Source changed: '+path);
const rows=[],locations=[];
const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const originalNow=Date.now;
try {
  for(const sample of data.samples) {
    const all=aircraftCandidates(sample.payload,sample.place,250,sample.recordedAt),known=new Set(sample.sampled);
    const routes=new Map();
    for(const a of all.filter(a=>known.has(a.callsign))) {
      const capture=sample.routes[a.callsign];
      const route=capture?.raw&&normalizeRoute(capture.raw,a,capture.provider);
      if(route)routes.set(a.callsign,route);
    }
    const complete=sample.routeSampleComplete&&sample.outcomes.length===sample.sampled.length;
    const qualified=[...routes].map(([callsign,route])=>{
      const aircraft=all.find(a=>a.callsign===callsign),profile=selectionProfile({aircraft,route},sample.place);
      return {callsign,destination:destinationCities(route.destination).primary.name,airport:route.destination.code,profile};
    });
    const eligible=qualified.filter(r=>r.profile.eligible);
    const rawCounts={};for(const radius of [50,100,250])rawCounts[radius]={observed:(sample.payload?.ac||[]).filter(a=>{const km=distanceKm(sample.place,a);return km!==null&&km<=radius*1.852;}).length,eligible:all.filter(a=>a.distanceFromPlaceKm<=radius*1.852).length};
    const primary=data.requests.find(r=>r.id.startsWith(sample.place.id+'-primary-'));
    let repeat=null;
    try {
      const payload=JSON.parse(await readFile(new URL(`./captures/${sample.place.id}-repeat.json`,import.meta.url),'utf8'));
      const recordedAt=observationTime(payload);repeat={recordedAt,minutesAfterFirst:+((recordedAt-sample.recordedAt)/60000).toFixed(2),raw:Array.isArray(payload.ac)?payload.ac.length:null,eligible:aircraftCandidates(payload,sample.place,250,recordedAt).length};
    }catch{}
    const rejection={local:qualified.filter(r=>r.profile.localDestination).length,short:qualified.filter(r=>r.profile.remainingKm<250||r.profile.airportRemainingKm<250).length,approaching:qualified.filter(r=>r.profile.approaching).length};
    // Conditional selection replay: only sampled aircraft are included, including
    // sampled route failures. An unavailable primary is modeled for every lookup;
    // explicit captured fallback associations are served unchanged. Full sky is
    // retained for count/coverage analysis, not silently treated as route-known.
    const payload={...sample.payload,ac:(sample.payload?.ac||[]).filter(a=>known.has(a.flight?.trim()))};
    Date.now=()=>sample.recordedAt;
    const fetcher=async url=> {
      if(url.startsWith('/api/nearby'))return json(payload,sample.status);
      if(url.startsWith('/api/route'))return json({},500);
      const capture=sample.routes[url.split('/').at(-1)];
      return capture?.raw?json(capture.raw,capture.status??200):json({},404);
    };
    const record=async(label,run,seed,options)=> {
      try {
        const round=await findNearbyRound(sample.place,{relay:true,fetcher,random:seeded(seed),...options});
        const profile=selectionProfile(round),destination=destinationCities(round.route.destination).primary.name;
        rows.push({location:sample.place.id,label,run,seed,selected:true,destination,callsign:round.aircraft.callsign,remainingKm:profile.remainingKm,headingError:profile.headingError,radiusNm:round.searchRadiusNm,routeRequests:round.diagnostics.routeRequests,distinctCompared:round.diagnostics.distinctDestinations});
        assert(profile.eligible);assert(round.diagnostics.routeRequests<=12);return round;
      }catch(e){rows.push({location:sample.place.id,label,run,seed,selected:false,error:e.code??e.name});return null;}
    };
    for(let run=0;run<20;run++)await record('fresh',run,2200+run,{});
    for(let session=0;session<10;session++) {
      let history=[],excludedDestinationIds=new Set();const excluded=new Set();
      for(let run=0;run<3;run++) {
        const round=await record('session',session*3+run,2500+session*11+run,{history,excluded,excludedDestinationIds});
        if(round){history=rememberSelection(history,round);excluded.add(round.aircraft.hex);excludedDestinationIds=new Set(destinationRepeatIds(round.route.destination));}
      }
    }
    const own=rows.filter(r=>r.location===sample.place.id);
    const summarize=label=> {
      const list=own.filter(r=>r.label===label),selected=list.filter(r=>r.selected),counts={},errors={};
      for(const r of selected)counts[r.destination]=(counts[r.destination]||0)+1;
      for(const r of list.filter(r=>!r.selected))errors[r.error]=(errors[r.error]||0)+1;
      return {attempted:list.length,playable:selected.length,destinationCounts:counts,errors,widerThan50:selected.filter(r=>r.radiusNm>50).length,widerThan100:selected.filter(r=>r.radiusNm>100).length};
    };
    locations.push({id:sample.place.id,name:sample.place.name,recordedAt:sample.recordedAt,capturedAt:sample.capturedAt,status:sample.status,raw:sample.rawAircraft,eligibleAircraft:all.length,rawCounts,routeSampleComplete:complete,sampled:sample.sampled.length,usableRoutes:routes.size,playableFlights:eligible.length,playableDestinations:[...new Set(eligible.map(r=>r.destination))],rejections:rejection,primaryProbe:primary?{callsign:primary.id.split('-primary-')[1],status:primary.status}:null,repeat,qualifyingExamples:eligible.map(r=>({callsign:r.callsign,destination:r.destination,remainingKm:Math.round(r.profile.remainingKm),headingError:Math.round(r.profile.headingError)})),replay:{fresh:summarize('fresh'),sessions:summarize('session')}});
  }
}finally{Date.now=originalNow;}
const rechecks=JSON.parse(await readFile(new URL('./recheck-requests.json',import.meta.url),'utf8'));
const report={generatedAt:new Date().toISOString(),requests:data.requests.length+rechecks.length,recheckRequests:rechecks,stopReason:data.stopped,qualification:'Twenty fresh seeded searches and ten three-round sessions per location (200 offline attempts). Replays use original observation clocks and only the sampled aircraft. Every primary route lookup is modeled unavailable; captured explicit fallback data are used. Replay availability is conditional on this sample, not a measured live full-sky search success rate. Empty snapshots include the full observed sky.',sourceHashesUnchanged:true,locations,rows};
await writeFile(new URL('./results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const alice=locations.find(s=>s.id==='alice-springs'),london=locations.find(s=>s.id==='london'),sydney=locations.find(s=>s.id==='sydney'),iceland=locations.find(s=>s.id==='reykjavik');
const lines=['Flightguesser availability across four other locations — 4 October 2026','',
`Alice Springs supplied ${alice.raw} observed aircraft at the full 250 nautical mile radius and ${alice.repeat?.raw??'unmeasured'} in the recheck ${alice.repeat?.minutesAfterFirst??'?'} minutes later. Every full-empty-sky replay correctly returned no-flight. This is a concrete availability problem for live play at these observed times, independent of the interest filters.`,
`London had ${london.eligibleAircraft} qualifying aircraft and ${london.playableDestinations.length} different playable destinations in twelve sampled routes. Aircraft scarcity was not a problem in this sample.`,
`Reykjavík had ${iceland.eligibleAircraft} qualifying aircraft, all sampled, yielding ${iceland.playableFlights} playable flights and ${iceland.playableDestinations.length} destinations. All ${iceland.replay.fresh.playable+iceland.replay.sessions.playable} replay attempts succeeded, but widening beyond the first radius was essential. Transatlantic overflights provided useful puzzles.`,
`Sydney had ${sydney.eligibleAircraft} qualifying aircraft but only ${sydney.playableFlights} playable flights to ${sydney.playableDestinations.length} destinations in twelve route samples. ${sydney.rejections.local} valid routes returned to Sydney and were rejected. The sampled pool gave ${sydney.replay.fresh.playable}/${sydney.replay.fresh.attempted} fresh searches and ${sydney.replay.sessions.playable}/${sydney.replay.sessions.attempted} session rounds. The unsampled aircraft could improve this; these rates cannot estimate live success across the full sky.`,
'For the product: keep widening the search and the recorded-flight recovery. Sparse data can leave no live puzzle; a busy sky can also yield few useful routes under the interest and request limits. Do not restore local arrivals as a fallback solely to conceal empty searches.',
'',report.qualification,'','Location | observed aircraft at 250 nm | qualifying aircraft | sampled/usable/playable flights | distinct playable destinations | route census complete'];
for(const s of locations)lines.push(`${s.name} | ${s.raw} | ${s.eligibleAircraft} | ${s.sampled}/${s.usableRoutes}/${s.playableFlights} | ${s.playableDestinations.join(', ')||'none'} | ${s.routeSampleComplete}`);
lines.push('','Search radius (qualifying aircraft at 50 / 100 / 250 nautical miles)');
for(const s of locations)lines.push(`${s.name}: ${[50,100,250].map(r=>s.rawCounts[r].eligible).join(' / ')}`);
lines.push('','Conditional recorded selection replay','Location | fresh playable/attempts | session playable/attempts | error counts');
for(const s of locations)lines.push(`${s.name} | ${s.replay.fresh.playable}/${s.replay.fresh.attempted} | ${s.replay.sessions.playable}/${s.replay.sessions.attempted} | ${JSON.stringify(s.replay.sessions.errors)}`);
lines.push('','Filtering and service observations');
for(const s of locations)lines.push(`${s.name}: ${JSON.stringify(s.rejections)} (overlapping rejection counts); primary probe ${s.primaryProbe?.status??'not needed'}; observation ${new Date(s.recordedAt).toISOString()}; later check ${s.repeat?JSON.stringify(s.repeat):'not sampled'}.`);
lines.push('','Limits','- Provider absence cannot distinguish actual absence of planes from receiver/reporting coverage. Raw counts describe observations from this provider.','- One instant per location, plus any explicitly reported sparse-region recheck, cannot establish coverage throughout a day. London was sampled in the morning; Sydney/Alice Springs in the evening; Reykjavík in the morning.','- At most twelve stratified aircraft were enriched per location. London/Sydney route pools are incomplete, so failures in their sampled replays cannot establish full-sky scarcity. A complete Reykjavík sample can establish scarcity for that observed subset.','- Original recorded timestamps are frozen only in labeled offline replays. No observation was refreshed to appear live. Primary outage, missing sampled routes, route geometry and the twelve-request budget can affect replay availability separately from plane counts.','- Service HTTP failures, missing reported routes, local/near-arrival filtering and true empty observations are recorded separately. Reported routes remain database associations, not confirmed flight plans.','- No production selection behavior was changed.','',`Captured ${report.requests} bounded requests (${data.requests.length} initial requests and ${rechecks.length} sparse-region rechecks); stop reason ${data.stopped??'completed sample'}. Source hashes unchanged. All replays are offline.`, 'Evidence: samples.json; captures/; results.json; source-hashes.json; capture.mjs; analyze.mjs.','');
await writeFile(new URL('./report.txt',import.meta.url),lines.join('\n'));
console.log(JSON.stringify({locations:locations.map(s=>({...s,qualifyingExamples:undefined})),replays:rows.length},null,2));
