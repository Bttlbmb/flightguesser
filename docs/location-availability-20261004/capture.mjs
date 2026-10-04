import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { aircraftCandidates, observationTime, normalizeRoute } from '../../public/flights.js';
import { orderAircraftCandidates, selectionProfile } from '../../public/selection.js';
import { destinationCities } from '../../public/destinations.js';
const exec=promisify(execFile);
const output=new URL('./captures/',import.meta.url);
await mkdir(output,{recursive:true});
const airports=JSON.parse(await readFile(new URL('../../public/data/airports.json',import.meta.url),'utf8'));
const area=id=>{const a=airports.find(a=>a.id===id);return {lat:a.lat,lon:a.lon};};
const places=[
{id:'london',name:'London',kind:'city',lat:51.5074,lon:-.1278},
{id:'sydney',name:'Sydney',kind:'city',lat:-33.8688,lon:151.2093},
{id:'reykjavik',name:'Reykjavík area',kind:'city',...area('BIRK')},
{id:'alice-springs',name:'Alice Springs area',kind:'city',...area('YBAS')},
];
const requests=[],samples=[];let stopped=null,transportFailures=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const randomFor=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
async function persist(){await writeFile(new URL('./samples.json',import.meta.url),JSON.stringify({capturedAt:new Date().toISOString(),stopped,requests,samples,qualification:'Four dated sky snapshots. All observations retained. At most twelve stratified callsign route associations sampled per location; this is not a census of routes or a live search success rate.'},null,2)+'\n');}
async function request(id,url,provider) {
  if(stopped)throw Error(stopped);
  const start=performance.now(),at=new Date().toISOString();let body='',status=0,error=null;
  try {
    const result=await exec('curl',['-sS','--max-time','12','-A','Flightguesser-local-MVP/0.1 (local-only availability audit)','-w','\n%{http_code}',url],{encoding:'utf8',maxBuffer:6000000});
    const split=result.stdout.lastIndexOf('\n');body=result.stdout.slice(0,split);status=Number(result.stdout.slice(split+1));
    transportFailures=0;
  } catch(e){error=e.message;transportFailures++;}
  const path=`${id}.json`;
  await writeFile(new URL(path,output),body);
  const meta={id,url,provider,at,receivedAt:new Date().toISOString(),status,durationMs:Math.round(performance.now()-start),file:`captures/${path}`,error};
  requests.push(meta);
  if(status===429)stopped=`${provider} rate limited; stopped all requests without retrying.`;
  if(transportFailures>=3)stopped='Three consecutive transport failures; stopped.';
  await persist();
  if(stopped)throw Error(stopped);
  await wait(provider==='adsb.lol'?4000:1250);
  let raw=null;try{raw=JSON.parse(body);}catch{}
  return {...meta,raw};
}
try {
  // Capture all regions before enriching routes so service/route issues cannot
  // obscure whether aircraft observations exist at the full search radius.
  for(const place of places) {
    const lat=Number(place.lat.toFixed(2)),lon=Number(place.lon.toFixed(2));
    const result=await request(`${place.id}-nearby`,`https://api.adsb.lol/v2/point/${lat}/${lon}/250`,'adsb.lol');
    const payload=result.raw,clock=observationTime(payload);
    const all=result.status===200?aircraftCandidates(payload,place,250,clock):[];
    const near={};for(const radius of [50,100,250])near[radius]={raw:Array.isArray(payload?.ac)?payload.ac.filter(a=>{const dx=(a.lat-place.lat)*111.2,dy=(a.lon-place.lon)*111.2*Math.cos(place.lat*Math.PI/180);return Math.hypot(dx,dy)<=radius*1.852;}).length:null,eligible:result.status===200?all.filter(a=>a.distanceFromPlaceKm<=radius*1.852).length:null};
    const sampled=[],random=randomFor(804+samples.length);
    for(const [lo,hi,count]of [[0,50,4],[50,100,4],[100,250,4]])sampled.push(...orderAircraftCandidates(all.filter(a=>a.distanceFromPlaceKm>=lo*1.852&&a.distanceFromPlaceKm<hi*1.852),random).slice(0,count));
    // Fill unused ring slots while retaining the deterministic stratified order.
    for(const a of orderAircraftCandidates(all,random))if(sampled.length<12&&!sampled.some(b=>b.hex===a.hex))sampled.push(a);
    const sample={place,status:result.status,capturedAt:result.receivedAt,recordedAt:clock,payload,rawAircraft:Array.isArray(payload?.ac)?payload.ac.length:null,eligibleAircraft:result.status===200?all.length:null,countsByRadius:near,sampled:sampled.map(a=>a.callsign),routeSampleComplete:sampled.length===all.length,routes:{},outcomes:[]};
    samples.push(sample);await persist();
    console.log(JSON.stringify({stage:'sky',location:place.name,status:result.status,raw:sample.rawAircraft,eligible:sample.eligibleAircraft,countsByRadius:near,sampled:sample.sampled.length}));
  }
  for(const sample of samples) {
    const all=aircraftCandidates(sample.payload,sample.place,250,sample.recordedAt);
    for(const [i,callsign]of sample.sampled.entries()) {
      const a=all.find(a=>a.callsign===callsign);let route=null;
      if(i===0) {
        const r=await request(`${sample.place.id}-primary-${callsign}`,`https://api.adsb.lol/api/0/route/${callsign}/${a.lat}/${a.lon}`,'adsb.lol');
        route=r.status===200?normalizeRoute(r.raw,a):null;
        // Contradictory primary routes must not be overridden by fallback.
        if(route)sample.routes[callsign]={provider:'adsb.lol',raw:r.raw};
        else if(Array.isArray(r.raw?._airports)&&r.raw._airports.length) {
          sample.outcomes.push({callsign,status:r.status,usable:false,reason:'primary-contradiction'});await persist();continue;
        }
      }
      if(!route) {
        const r=await request(`${sample.place.id}-db-${callsign}`,`https://api.adsbdb.com/v0/callsign/${callsign}`,'adsbdb');
        sample.routes[callsign]={provider:'adsbdb',status:r.status,raw:r.raw};
        route=r.status===200?normalizeRoute(r.raw,a,'adsbdb'):null;
      }
      let profile=null;try{if(route)profile=selectionProfile({aircraft:a,route},sample.place);}catch{}
      const outcome={callsign,usable:!!route,airport:route?.destination.code,destination:route?destinationCities(route.destination).primary.name:null,profile};
      sample.outcomes.push(outcome);await persist();
      console.log(JSON.stringify({stage:'route',location:sample.place.name,callsign,usable:outcome.usable,destination:outcome.destination,eligible:profile?.eligible,local:profile?.localDestination,km:profile?Math.round(profile.remainingKm):null}));
    }
  }
} catch(e){stopped=e.message;}finally{
  const paths=['public/api.js','public/selection.js','public/flights.js','public/destinations.js','public/data/airports.json'];
  const hashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../'+p,import.meta.url))).digest('hex')])));
  await persist();await writeFile(new URL('./source-hashes.json',import.meta.url),JSON.stringify(hashes,null,2)+'\n');
  console.log(JSON.stringify({complete:true,requests:requests.length,stopped,locations:samples.map(s=>({name:s.place.name,eligible:s.eligibleAircraft,sampled:s.sampled.length,usable:s.outcomes.filter(o=>o.usable).length,playable:s.outcomes.filter(o=>o.profile?.eligible).length}))}));
}
