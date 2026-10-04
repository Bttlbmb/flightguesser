// Synthetic selection audit. No provider requests are made.
import { findNearbyRound } from '../../public/api.js';
import { aircraftCandidates, normalizeRoute } from '../../public/flights.js';
import { rememberSelection, selectionProfile } from '../../public/selection.js';
import { destinationCities, destinationRepeatIds } from '../../public/destinations.js';
import { distanceKm, bearingDegrees, angularDifference } from '../../public/geo.js';
const seoul = { name: 'Seoul', lat: 37.5665, lon: 126.978, kind: 'city' };
const airport = (icao, iata, city, countryiso2, lat, lon) => ({ icao, iata, name: city + ' Airport', location: city, countryiso2, lat, lon });
const airports = {
 ICN: airport('RKSI','ICN','Seoul','KR',37.469101,126.450996), GMP: airport('RKSS','GMP','Seoul','KR',37.5583,126.7906),
 CJU: airport('RKPC','CJU','Jeju','KR',33.5113,126.493), PUS: airport('RKPK','PUS','Busan','KR',35.1795,128.9382),
 HND: airport('RJTT','HND','Tokyo','JP',35.5523,139.78), KIX: airport('RJBB','KIX','Osaka','JP',34.4347,135.244),
 CTS: airport('RJCC','CTS','Sapporo','JP',42.7752,141.6923), FUK: airport('RJFF','FUK','Fukuoka','JP',33.5859,130.451),
 KIJ: airport('RJSN','KIJ','Niigata','JP',37.9559,139.121), PEK: airport('ZBAA','PEK','Beijing','CN',40.0801,116.585),
 PVG: airport('ZSPD','PVG','Shanghai','CN',31.1434,121.805), TPE: airport('RCTP','TPE','Taipei','TW',25.0777,121.233),
 HKG: airport('VHHH','HKG','Hong Kong','HK',22.308,113.918), BKK: airport('VTBS','BKK','Bangkok','TH',13.69,100.75),
 SIN: airport('WSSS','SIN','Singapore','SG',1.3502,103.994), DXB: airport('OMDB','DXB','Dubai','AE',25.2528,55.3644),
 VVO: airport('UHWW','VVO','Vladivostok','RU',43.399,132.148),
};
const airlineCodes = ['KAL','AAR','JJA','JNA','APJ','CAL','CCA','SIA','THA','UAE'];
function seeded(seed) {
 let value = seed >>> 0;
 return () => { value = (value + 0x6D2B79F5) >>> 0; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function along(a,b,f) {
 const radians = degrees => degrees * Math.PI / 180;
 const vector = point => [Math.cos(radians(point.lat))*Math.cos(radians(point.lon)),Math.cos(radians(point.lat))*Math.sin(radians(point.lon)),Math.sin(radians(point.lat))];
 const A=vector(a),B=vector(b);
 const omega=Math.acos(Math.max(-1,Math.min(1,A.reduce((sum,value,index)=>sum+value*B[index],0))));
 const denominator=Math.sin(omega);
 const C=A.map((value,index)=>Math.sin((1-f)*omega)/denominator*value+Math.sin(f*omega)/denominator*B[index]);
 return {lat:Math.atan2(C[2],Math.hypot(C[0],C[1]))*180/Math.PI,lon:Math.atan2(C[1],C[0])*180/Math.PI};
}
function flight(index,origin,destination,fraction,properties={}) {
 const point=along(origin,destination,fraction),callsign=airlineCodes[index%airlineCodes.length]+(100+index),track=bearingDegrees(point,destination);
 return {category:properties.category||'departure',
  aircraft:{hex:(0xaab000+index).toString(16),flight:callsign,...point,alt_baro:32000,gs:430,track,true_heading:track,baro_rate:0,seen:1,seen_pos:1,...properties},
  route:{callsign,plausible:true,airline_code:callsign.slice(0,3),_airports:[origin,destination]}};
}
function arrivals(count,offset=0,distant=false) {
 return Array.from({length:count},(_,index)=>{
  const origin=airports[['HND','PEK','CJU','CTS','KIX','PVG'][index%6]],destination=index%8===7?airports.GMP:airports.ICN;
  const remainder=distant?180+index*3:10+index*1.6;
  return flight(offset+index,origin,destination,1-Math.min(0.8,remainder/distanceKm(origin,destination)),{alt_baro:distant?31000:4300+index*140,gs:distant?430:240,baro_rate:distant?-200:-1400,category:'local-arrival'});
 });
}
function departures(offset=100,distanceOffset=0) {
 return Object.entries(airports).filter(([code])=>!['ICN','GMP'].includes(code)).map(([code,destination],index)=>{
  const flownKm=35+index*5+distanceOffset;
  return flight(offset+index,airports.ICN,destination,Math.min(0.45,flownKm/distanceKm(airports.ICN,destination)),{alt_baro:26000,baro_rate:400,category:code==='CJU'||code==='PUS'?'domestic-departure':'international-departure'});
 });
}
function transits(offset=300) {
 return [['HND','PEK'],['CTS','PVG'],['VVO','HKG'],['HND','PVG'],['PEK','KIX'],['PVG','CTS']].map(([originCode,destinationCode],index)=>{
  const origin=airports[originCode],destination=airports[destinationCode];let bestFraction=0.5,closest=Infinity;
  for(let step=1;step<100;step++){const fraction=step/100,distance=distanceKm(seoul,along(origin,destination,fraction));if(distance<closest){closest=distance;bestFraction=fraction;}}
  return flight(offset+index,origin,destination,bestFraction,{category:'transit'});
 });
}
const badDisplayedHeading=departures(500).slice(2,7).map(entry=>({...entry,category:'turning-heading',aircraft:{...entry.aircraft,true_heading:(entry.aircraft.track+75)%360}}));
const pools={
 'dense-seoul':[...arrivals(30),...departures(),...transits(),...badDisplayedHeading],
 'arrival-flood':[...arrivals(70),...arrivals(22,700,true),...departures(),...transits(),...badDisplayedHeading],
 'wider-transit':[...arrivals(25),...arrivals(16,700,true),...departures(100,155),...transits(),...badDisplayedHeading],
 'regional-mix':[...arrivals(20),...departures(),...departures(200,120),...transits(),...badDisplayedHeading],
 'sparse-two':[...arrivals(5),...departures().filter(entry=>['ZBAA','RJTT'].includes(entry.route._airports[1].icao))],
 'only-local-arrivals':[...arrivals(24),...arrivals(12,700,true)],
};
function freshPool(pool,run){return pool.map((entry,index)=>({...entry,aircraft:{...entry.aircraft,hex:(0xaab000+run*2048+index).toString(16)}}));}
function json(value,status=200){return new Response(JSON.stringify(value),{status});}
function fetchFixture(entries,counters){
 const routes=new Map(entries.map(entry=>[entry.aircraft.flight,entry.route]));
 return async url=>{
  if(url.startsWith('/api/nearby')){counters.nearby++;return json({now:Date.now(),ac:entries.map(entry=>entry.aircraft)});}
  counters.routes++;
  if(url.startsWith('/api/route'))return json(routes.get(url.split('/')[3])||{_airports:[]});
  return json({response:{}},404);
 };
}
function summary(rows){
 const selected=rows.filter(row=>!row.error);
 const counts=key=>Object.fromEntries([...new Set(selected.map(row=>row[key]))].sort().map(value=>[value,selected.filter(row=>row[key]===value).length]));
 const recentRepeats=selected.filter((row,index)=>selected.slice(Math.max(0,index-10),index).some(previous=>previous.session===row.session&&previous.city===row.city)).length;
 return {
  attempts:rows.length,selected:selected.length,uniqueCities:new Set(selected.map(row=>row.city)).size,uniqueCountries:new Set(selected.map(row=>row.country)).size,
  destinations:counts('city'),countries:counts('country'),categories:counts('category'),lengthBands:counts('lengthBand'),
  localDestinations:selected.filter(row=>row.localDestination).length,
  under250kmRemaining:selected.filter(row=>row.remainingAirportKm<250||row.remainingCityKm<250).length,
  nearDescent:selected.filter(row=>row.remainingAirportKm<500&&row.altitudeFt<12000&&row.verticalRateFpm<-300).length,
  usefulHeadingWithin30Degrees:selected.filter(row=>row.headingDifference<=30).length,
  usefulHeadingRate:selected.length?selected.filter(row=>row.headingDifference<=30).length/selected.length:null,
  immediateCityRepeats:selected.filter((row,index)=>selected[index-1]?.session===row.session&&selected[index-1]?.city===row.city).length,
  repeatsWithinLast10:recentRepeats,meanRouteRequests:rows.length?rows.reduce((sum,row)=>sum+row.routeRequests,0)/rows.length:0,
  maxRouteRequests:Math.max(0,...rows.map(row=>row.routeRequests)),maxNearbyRequests:Math.max(0,...rows.map(row=>row.nearbyRequests)),
  errorCodes:Object.fromEntries([...new Set(rows.filter(row=>row.error).map(row=>row.error))].map(error=>[error,rows.filter(row=>row.error===error).length])),
 };
}
async function runSession(find,poolName,count,seed,remember=true){
 let history=[],previous=new Set();const rows=[];
 for(let run=0;run<count;run++){
  const entries=freshPool(pools[poolName],run),counters={routes:0,nearby:0};
  try{
   const round=await find(seoul,{relay:true,random:seeded(seed+run*7919),history:remember?history:[],excludedDestinationIds:remember?previous:new Set(),fetcher:fetchFixture(entries,counters)});
   const destination=destinationCities(round.route.destination),city=destination.primary;
   const entry=entries.find(entry=>entry.aircraft.hex===round.aircraft.hex);
   const remainingAirportKm=distanceKm(round.aircraft,round.route.destination),remainingCityKm=distanceKm(round.aircraft,city);
   const heading=round.aircraft.trueHeading??round.aircraft.track;
   const localDestination=distanceKm(seoul,round.route.destination)<150||destination.accepted.some(city=>distanceKm(seoul,city)<150);
   let profile=null;try{profile=selectionProfile(round);}catch{}
   rows.push({session:poolName,run:run+1,city:city.name,country:city.country,airport:round.route.destination.id,callsign:round.aircraft.callsign,
    category:entry?.category,remainingAirportKm:Math.round(remainingAirportKm),remainingCityKm:Math.round(remainingCityKm),
    lengthBand:profile?.lengthBand??(remainingCityKm<1500?'regional':remainingCityKm<5000?'medium':'long'),
    headingDifference:angularDifference(heading,bearingDegrees(round.aircraft,city)),localDestination,
    altitudeFt:round.aircraft.altitudeFt,verticalRateFpm:round.aircraft.verticalRateFpm,
    routeRequests:counters.routes,nearbyRequests:counters.nearby,diagnostics:round.diagnostics});
   if(remember){previous=new Set(destinationRepeatIds(round.route.destination,destination));history=rememberSelection(history,round);}
  }catch(error){rows.push({session:poolName,run:run+1,error:error.code||error.name,routeRequests:counters.routes,nearbyRequests:counters.nearby});}
 }
 return rows;
}
export async function audit(){
 const fixtureValidation=Object.fromEntries(Object.entries(pools).map(([name,entries])=>{
  const normalized=aircraftCandidates({now:Date.now(),ac:entries.map(entry=>entry.aircraft)},seoul,250);
  const usableRoutes=normalized.filter(aircraft=>normalizeRoute(entries.find(entry=>entry.aircraft.flight===aircraft.callsign)?.route,aircraft));
  return [name,{observations:entries.length,normalizedWithin463km:normalized.length,validExplicitRoutes:usableRoutes.length}];
 }));
 const names=['dense-seoul','arrival-flood','wider-transit','regional-mix','sparse-two'],improvedRows=[];
 for(let index=0;index<names.length;index++)improvedRows.push(...await runSession(findNearbyRound,names[index],12,1200+index*10000));
 const noHistoryRows=await runSession(findNearbyRound,'dense-seoul',40,92117,false),arrivalOnlyRows=await runSession(findNearbyRound,'only-local-arrivals',20,4600,false);
 const checks={
  sixtyTrackedAttempts:improvedRows.length===60,
  sixtySuccessfulTrackedSelections:improvedRows.filter(row=>!row.error).length===60,
  fortySuccessfulNoHistorySelections:noHistoryRows.filter(row=>!row.error).length===40,
  allImprovedSelectionsAvoidLocalAnswers:improvedRows.filter(row=>!row.error).every(row=>!row.localDestination),
  allImprovedSelectionsHaveRoomRemaining:improvedRows.filter(row=>!row.error).every(row=>row.remainingAirportKm>=250&&row.remainingCityKm>=250),
  allImprovedSelectionsAvoidNearDescent:improvedRows.filter(row=>!row.error).every(row=>!(row.remainingAirportKm<500&&row.altitudeFt<12000&&row.verticalRateFpm<-300)),
  routeBudgetPreserved:[...improvedRows,...noHistoryRows,...arrivalOnlyRows].every(row=>row.routeRequests<=12),
  nearbyBudgetPreserved:[...improvedRows,...noHistoryRows,...arrivalOnlyRows].every(row=>row.nearbyRequests<=3),
  noHistoryProducesVariety:summary(noHistoryRows).uniqueCities>=4,
  onlyLocalCoverageExplicitlyRejected:arrivalOnlyRows.every(row=>row.error==='no-interesting-flight'),
 };
 return {methodology:{evidence:'synthetic',networkRequests:0,date:'2026-10-04',
  note:'Five 12-round seeded sessions use fabricated but normalized observations and explicit routes around Seoul. Each frame keeps routes but refreshes aircraft identity to model replenishing traffic. Dense pools deliberately overrepresent ICN/GMP arrivals, including inbound cruise flights up to300km from ICN. Sparse pools have only two nonlocal answers. Forty no-history runs isolate sampler variety; twenty local-only runs check refusal. This tests observable selection properties, not human enjoyment or live traffic distributions.',fixtureValidation},
  improved:summary(improvedRows),sessions:Object.fromEntries(names.map(name=>[name,{improved:summary(improvedRows.filter(row=>row.session===name))}])),
  noHistory:summary(noHistoryRows),onlyLocal:summary(arrivalOnlyRows),checks,rows:{improved:improvedRows,noHistory:noHistoryRows,onlyLocal:arrivalOnlyRows}};
}
const report=await audit();
console.log(JSON.stringify(report,null,2));
if(Object.values(report.checks).some(pass=>!pass))process.exitCode=1;
