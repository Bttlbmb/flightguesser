// Small curated direct city-to-airport links, not a metropolitan code directory.
// See docs/city-destinations.md for evidence, reference-point limits and updates.
// Never infer additional edges through a shared airport, a radius or a city name.

const entryPoint = name => ({
  kind: 'existing-curated-point',
  source: 'public/app.js cities list, captured 2026-10-03',
  note: `${name} reference point retained from the existing entry selector; approximate, not an official municipal centroid.`,
});

const airportPoint = airportId => ({
  kind: 'airport-coordinate-fallback',
  source: 'public/data/airports.json, captured 2026-10-03',
  airportId,
  note: 'Airport position used as a provisional city reference point; not a city center or municipal centroid.',
});

const sources = {
  seoul: 'https://english.visitseoul.net/airport-to-seoul',
  incheon: 'https://english.visitseoul.net/essential-Info-article/Tourist-Information-Centers_/396',
  tokyo: 'https://www.japan.travel/en/plan/airport-access/haneda-airport/',
  narita: 'https://www.narita-airport.jp/en/company/naa/profile/summary/',
  london: 'https://www.visitlondon.com/traveller-information/travel-to-london/airport',
  newYork: 'https://www.jfkairport.com/flights/connections-guide/travel-between-airports',
  paris: 'https://parisjetaime.com/eng/convention/article/Arriving-train-plane-a1870',
  niigata: 'https://www.niigata-airport.gr.jp/about/',
  jeju: 'https://www.airport.co.kr/jejueng/cms/frCon/index.do?MENU_ID=270',
  portlandOregon: 'https://www.flypdx.com/Contact?culture=en',
  portlandMaine: 'https://portlandjetport.org/contact-us',
  krakow: 'https://krakowairport.pl/en/company/airport/about-airport/about/catchment-area',
  athens: 'https://www.aia.gr/en/traveller/transportation-airport/public-transportation-airport',
};

export const CITY_LINKS = [
  {
    id: 'kr-seoul', name: 'Seoul', country: 'KR',
    lat: 37.5665, lon: 126.978,
    airportIds: ['RKSI', 'RKSS'], primaryFor: ['RKSI', 'RKSS'],
    coordinateSource: entryPoint('Seoul'), membershipSources: [sources.seoul],
    membershipKind: 'served-city',
  },
  {
    id: 'kr-incheon', name: 'Incheon', country: 'KR',
    lat: 37.469101, lon: 126.450996,
    airportIds: ['RKSI'], primaryFor: [],
    coordinateSource: airportPoint('RKSI'), membershipSources: [sources.incheon],
    membershipKind: 'physical-municipality',
  },
  {
    id: 'jp-tokyo', name: 'Tokyo', country: 'JP',
    lat: 35.6762, lon: 139.6503,
    airportIds: ['RJTT', 'RJAA'], primaryFor: ['RJTT', 'RJAA'],
    coordinateSource: entryPoint('Tokyo'), membershipSources: [sources.tokyo],
    membershipKind: 'served-city',
  },
  {
    id: 'jp-narita', name: 'Narita', country: 'JP',
    lat: 35.76858, lon: 140.388714,
    airportIds: ['RJAA'], primaryFor: [],
    coordinateSource: airportPoint('RJAA'), membershipSources: [sources.narita],
    membershipKind: 'physical-municipality',
  },
  {
    id: 'gb-london', name: 'London', country: 'GB',
    lat: 51.5074, lon: -0.1278,
    airportIds: ['EGLL', 'EGKK', 'EGLC', 'EGGW', 'EGSS', 'EGMC'],
    primaryFor: ['EGLL', 'EGKK', 'EGLC', 'EGGW', 'EGSS', 'EGMC'],
    coordinateSource: entryPoint('London'), membershipSources: [sources.london],
    membershipKind: 'served-city',
  },
  {
    id: 'us-new-york', name: 'New York', country: 'US',
    aliases: ['New York City', 'NYC'],
    lat: 40.7128, lon: -74.006,
    airportIds: ['KJFK', 'KLGA', 'KEWR'], primaryFor: ['KJFK', 'KLGA', 'KEWR'],
    coordinateSource: entryPoint('New York'), membershipSources: [sources.newYork],
    membershipKind: 'served-city',
  },
  {
    id: 'us-newark', name: 'Newark', country: 'US',
    lat: 40.6894, lon: -74.170545,
    airportIds: ['KEWR'], primaryFor: [],
    coordinateSource: airportPoint('KEWR'),
    membershipSources: ['public/data/airports.json: KEWR municipality'],
    membershipKind: 'source-municipality',
  },
  {
    id: 'fr-paris', name: 'Paris', country: 'FR',
    lat: 48.8566, lon: 2.3522,
    airportIds: ['LFPG', 'LFPO'], primaryFor: ['LFPG', 'LFPO'],
    coordinateSource: entryPoint('Paris'), membershipSources: [sources.paris],
    membershipKind: 'served-city',
  },
  {
    id: 'jp-niigata', name: 'Niigata', country: 'JP',
    lat: 37.954166, lon: 139.112189,
    airportIds: ['RJSN'], primaryFor: ['RJSN'],
    coordinateSource: airportPoint('RJSN'), membershipSources: [sources.niigata],
    membershipKind: 'physical-municipality',
  },
  {
    id: 'kr-jeju-city', name: 'Jeju City', country: 'KR',
    lat: 33.512058, lon: 126.492548,
    airportIds: ['RKPC'], primaryFor: ['RKPC'],
    coordinateSource: airportPoint('RKPC'), membershipSources: [sources.jeju],
    membershipKind: 'physical-municipality',
  },
  {
    id: 'us-portland-or', name: 'Portland', country: 'US', region: 'Oregon',
    aliases: ['Portland Oregon', 'Portland, Oregon', 'Portland OR'],
    lat: 45.588699, lon: -122.598,
    airportIds: ['KPDX'], primaryFor: ['KPDX'],
    coordinateSource: airportPoint('KPDX'), membershipSources: [sources.portlandOregon],
    membershipKind: 'physical-municipality',
  },
  {
    id: 'us-portland-me', name: 'Portland', country: 'US', region: 'Maine',
    aliases: ['Portland Maine', 'Portland, Maine', 'Portland ME'],
    lat: 43.646198, lon: -70.309303,
    airportIds: ['KPWM'], primaryFor: ['KPWM'],
    coordinateSource: airportPoint('KPWM'), membershipSources: [sources.portlandMaine],
    membershipKind: 'physical-municipality',
  },
  {
    id: 'pl-krakow', name: 'Kraków', country: 'PL',
    aliases: ['Krakow'],
    lat: 50.077702, lon: 19.7848,
    airportIds: ['EPKK'], primaryFor: ['EPKK'],
    coordinateSource: airportPoint('EPKK'), membershipSources: [sources.krakow],
    membershipKind: 'served-city',
  },
  {
    // Retain the old municipality ID and picker context as a secondary answer.
    id: 'airport:PL:EPKK', name: 'Balice', country: 'PL', fallback: true,
    lat: 50.077702, lon: 19.7848,
    airportIds: ['EPKK'], primaryFor: [],
    coordinateSource: airportPoint('EPKK'),
    membershipSources: ['public/data/airports.json: EPKK municipality'],
    membershipKind: 'source-municipality',
  },
  {
    id: 'gr-athens', name: 'Athens', country: 'GR',
    lat: 37.936401, lon: 23.9445,
    airportIds: ['LGAV'], primaryFor: ['LGAV'],
    coordinateSource: airportPoint('LGAV'), membershipSources: [sources.athens],
    membershipKind: 'served-city',
  },
  {
    id: 'airport:GR:LGAV', name: 'Spata-Artemida', country: 'GR', fallback: true,
    lat: 37.936401, lon: 23.9445,
    airportIds: ['LGAV'], primaryFor: [],
    coordinateSource: airportPoint('LGAV'),
    membershipSources: ['public/data/airports.json: LGAV municipality'],
    membershipKind: 'source-municipality',
  },
];
