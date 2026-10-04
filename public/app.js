import { findNearbyRound, enrichRouteAirline, runtimeConfig, DataError } from './api.js';
import { airportLabel, countryName, mergeRouteAirports, hasMunicipality } from './airports.js';
import { indexCities, searchCities, cityLabel, destinationRepeatIds } from './destinations.js';
import { validCoordinates, distanceKm } from './geo.js';
import { rememberSelection } from './selection.js';
import { createGame, submitGuess, revealClue, MAX_GUESSES, DIFFICULTIES } from './game.js';

const app = document.querySelector('#app');
const announcer = document.querySelector('#announcer');
const dialog = document.querySelector('#info-dialog');
const initialHTML = app.innerHTML;
const cities = [
  { name: 'Seoul', lat: 37.5665, lon: 126.978 },
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'New York', lat: 40.7128, lon: -74.006 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
];
let state = { view: 'entry', game: null, cityIndex: [], selected: null, query: '', results: [], activeResult: -1, clueBookOpen: true };
// Keep the phone book collapsible after rotation, while retaining the desktop
// layout on a short window with a fine pointer. Match the stylesheet query.
const phoneLayout = matchMedia('(max-width: 700px), (pointer: coarse) and (max-width: 1000px) and (max-height: 500px)');
// Every view-changing request gets a token. Late location or network callbacks
// may finish, but cannot replace the user's newer screen.
let generation = 0;
let controller;
let configPromise;
let airportPromise;
let practicePromise;
let globePromise;
let globeHTML;
let practiceIndex = 0;
let difficulty = 'normal';
let lastPlace;
let elsewhereCityIndex = 0;
let retryTimer;
let announcementFrame;
const playedAircraft = new Set();
let lastDestinationIds = new Set();
let selectionHistory = [];
let keyboardInteraction = false;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const degrees = value => `${Math.round(value) % 360}`.padStart(3, '0');
const announce = value => {
  cancelAnimationFrame(announcementFrame);
  announcer.textContent = '';
  announcementFrame = requestAnimationFrame(() => { announcer.textContent = value; });
};
const focusHeading = () => {
  cancelAnimationFrame(announcementFrame);
  announcer.textContent = '';
  scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const heading = app.querySelector('h1');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
};

function difficultyHTML(label = 'Difficulty') {
  return `<div class="difficulty-control"><label for="difficulty-select">${label}</label>
    <select id="difficulty-select" aria-describedby="difficulty-note"><option value="normal" ${difficulty === 'normal' ? 'selected' : ''}>Normal · precise distances</option><option value="hard" ${difficulty === 'hard' ? 'selected' : ''}>Hard · distance ranges</option></select>
    <p class="difficulty-note" id="difficulty-note">Hard mode gives destination distance ranges. Six guesses in either mode.</p></div>`;
}

function setDifficulty(value) {
  if (!DIFFICULTIES.includes(value)) throw new Error('Choose Normal or Hard difficulty.');
  if (state.view === 'loading' || (state.view === 'game' && state.game.status === 'playing')) throw new Error('Finish the round before changing difficulty.');
  difficulty = value;
  const select = app.querySelector('#difficulty-select');
  if (select) select.value = value;
}

function renderEntry() {
  state.view = 'entry';
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = initialHTML;
  app.querySelector('#difficulty-select').value = difficulty;
  focusHeading();
}

function renderCities(message = '') {
  state.view = 'city';
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<section class="entry city-entry">
    <button class="text-button back" data-action="home">Back</button>
    <p class="eyebrow">PICK YOUR PATCH OF SKY</p><h1>Play from a city.</h1>
    <p class="intro">We’ll look for a flight near the place you choose.</p>
    ${message ? `<p class="note" role="status">${escape(message)}</p>` : ''}
    <form id="city-form" class="place-form"><label for="city-select">City</label>
      <select id="city-select" required><option value="">Choose a city</option>${cities.map((city, index) => `<option value="${index}">${city.name}</option>`).join('')}</select>
      ${difficultyHTML()}
      <button class="button primary" type="submit">Find a flight</button>
    </form><p class="privacy">City coordinates are sent to adsb.lol. Your device location isn’t used.</p>
  </section>`;
  focusHeading();
}

function renderLoading(title, detail) {
  state.view = 'loading';
  app.setAttribute('aria-busy', 'true');
  app.innerHTML = `<section class="loading"><div class="loading-mark" aria-hidden="true"></div>
    <h1>${escape(title)}</h1><p class="note" id="loading-detail" role="status">${escape(detail)}</p>
    <button class="text-button" data-action="cancel">Cancel</button></section>`;
  focusHeading();
}

function renderError(error) {
  state.view = 'error';
  app.setAttribute('aria-busy', 'false');
  const noInterestingFlight = error.code === 'no-interesting-flight';
  const noFlight = error.code === 'no-flight' || noInterestingFlight;
  const noNewDestination = error.code === 'no-new-destination';
  const noNewRecording = error.code === 'no-new-practice-destination';
  const canLookElsewhere = !!lastPlace && (noFlight || noNewDestination);
  state.canLookElsewhere = canLookElsewhere;
  const blocked = error.code === 'network' && !error.relay;
  const limited = error.code === 'rate-limit';
  const title = noNewRecording ? 'No different recorded destination.' : noNewDestination ? 'No different destination nearby.' : noFlight ? 'No puzzle in this patch of sky.' : limited ? 'A short pause.' : blocked ? 'Live data isn’t available here.' : 'We couldn’t find a flight.';
  const detail = blocked ? 'We couldn’t read the live aircraft data. Browser access restrictions or a connection problem can cause this. You can still play a recorded flight.'
    : limited ? `The aircraft service has asked us to wait. Try again in ${Math.max(1, error.retryAfter ?? 60)} seconds, or play a recorded flight.`
    : noNewDestination ? 'The usable flights we found share your last destination. Look elsewhere, search again, or play a recorded flight.'
    : noInterestingFlight ? 'The flights we found were heading back here or too close to landing. Look elsewhere, search again, or play a recorded flight.'
    : noFlight ? 'We searched up to 463 km away. None of the fresh aircraft had a clear, single-leg reported route for this game.'
    : error.message;
  const retryAfter = limited ? Math.max(1, error.retryAfter ?? 60) : 0;
  state.retryAt = Date.now() + retryAfter * 1000;
  app.innerHTML = `<section class="error"><p class="eyebrow">${noFlight || noNewDestination ? 'NO GUESSWORK ABOUT THE DATA' : 'THE SKY CAN WAIT'}</p>
    <h1>${escape(title)}</h1><p class="note">${escape(detail)}</p>
    ${canLookElsewhere ? '<button class="button primary" data-action="elsewhere">Look elsewhere</button>' : ''}
    ${difficultyHTML()}
    <button class="button ${canLookElsewhere ? 'secondary' : 'primary'}" data-action="${noNewRecording ? 'cities' : 'practice'}">${noNewRecording ? 'Choose a starting city' : 'Play a recorded flight'}</button>
    ${lastPlace && !blocked ? `<button class="button secondary" data-action="retry" ${limited ? 'disabled' : ''}>${limited ? 'Try again shortly' : 'Search again'}</button>` : ''}
    ${!blocked && !noNewRecording ? '<button class="text-button" data-action="cities">Choose another city</button>' : '<button class="text-button" data-action="home">Back to start</button>'}
  </section>`;
  focusHeading();
  announce(`${title} ${detail}`);
  if (limited) {
    const token = generation;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (token === generation && state.view === 'error') {
        const retry = app.querySelector('[data-action="retry"]');
        if (retry) { retry.disabled = false; retry.textContent = 'Search again'; }
      }
    }, Math.min(retryAfter * 1000, 2147483647));
  }
}

function invalidatePending() {
  controller?.abort();
  controller = null;
  clearTimeout(retryTimer);
  return ++generation;
}

function cancel() {
  invalidatePending();
  renderEntry();
}

function locate() {
  if (!navigator.geolocation) return renderCities('Location isn’t supported in this browser. Choose a city to play.');
  if (!isSecureContext) return renderCities('Location needs HTTPS or localhost. Choose a city to play here.');
  const token = invalidatePending();
  renderLoading('Finding your patch of sky.', 'Waiting for your location permission…');
  navigator.geolocation.getCurrentPosition(position => {
    if (token !== generation) return;
    startSearch({ lat: position.coords.latitude, lon: position.coords.longitude, name: 'you', kind: 'device' });
  }, error => {
    if (token !== generation) return;
    renderCities(error.code === 1 ? 'Location wasn’t shared. You can still play from a city.'
      : error.code === 3 ? 'Finding your location took too long. Choose a city instead.'
      : 'Your location couldn’t be found. Choose a city instead.');
    announce('Choose a city to play without device location.');
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
}

function lookElsewhere() {
  if (state.view !== 'error' || !state.canLookElsewhere || !lastPlace) return;
  for (let offset = 0; offset < cities.length; offset++) {
    const index = (elsewhereCityIndex + offset) % cities.length;
    const city = cities[index];
    // A device location can be near a listed city without sharing its name.
    if (distanceKm(lastPlace, city) < 150) continue;
    elsewhereCityIndex = (index + 1) % cities.length;
    startSearch({ ...city, kind: 'city' });
    return;
  }
}

async function startSearch(place) {
  lastPlace = place;
  const token = invalidatePending();
  const searchController = new AbortController();
  controller = searchController;
  renderLoading(`Finding a flight near ${place.kind === 'device' ? 'you' : place.name}.`, 'Looking for fresh aircraft with a reported destination…');
  let config = { relay: false };
  try {
    const [loadedConfig, airports] = await Promise.all([configPromise ??= runtimeConfig(), loadAirports()]);
    config = loadedConfig;
    if (token !== generation || searchController.signal.aborted) return;
    const round = await findNearbyRound(place, {
      signal: searchController.signal, relay: config.relay, excluded: playedAircraft, excludedDestinationIds: lastDestinationIds, history: selectionHistory,
      // Use the same municipality recovery as the city picker. Provider positions
      // stay intact; a missing city label must not defeat destination rotation.
      resolveDestination: destinationResolver(airports),
      onProgress: progress => {
        if (token !== generation) return;
        const node = app.querySelector('#loading-detail');
        if (node) node.textContent = progress.stage === 'nearby' ? `Searching within ${progress.radiusKm} km…` : 'Checking for a usable reported route…';
      },
    });
    if (token !== generation) return;
    round.route = await enrichRouteAirline(round.route, { signal: searchController.signal });
    if (token !== generation) return;
    await openRound(round, token);
    if (token === generation) playedAircraft.add(round.aircraft.hex);
  } catch (error) {
    if (token !== generation || error.name === 'AbortError') return;
    error.relay = config.relay;
    renderError(error);
  }
}

async function practice() {
  const token = invalidatePending();
  renderLoading('Opening a recorded flight.', 'A real recorded observation, with its reported destination.');
  try {
    practicePromise ??= loadLocalArray('./data/practice.json', 'practice', 'The recorded flight could not be loaded. Try again.',
      validRecordedRound)
      .catch(error => { practicePromise = null; throw error; });
    const [rounds, airports] = await Promise.all([practicePromise, loadAirports()]);
    if (token !== generation) return;
    const resolveDestination = destinationResolver(airports);
    // Live and recorded rounds share the last destination. Skip recordings that
    // accept any of the same cities, even when they use a different airport.
    const nextIndex = Array.from({ length: rounds.length }, (_, offset) => (practiceIndex + offset) % rounds.length)
      .find(index => !destinationRepeatIds(resolveDestination(rounds[index].route.destination)).some(id => lastDestinationIds.has(id)));
    if (nextIndex === undefined) throw new DataError('no-new-practice-destination', 'No recorded flight has a different destination. Choose a starting city to find another flight.');
    const round = rounds[nextIndex];
    await openRound(round, token);
    // A cancelled or failed load should not consume a recorded round.
    if (token === generation) practiceIndex = (nextIndex + 1) % rounds.length;
  } catch (error) { if (token === generation) renderError(error); }
}

function validLocalAirport(airport) {
  return validCoordinates(airport) && typeof airport.id === 'string' && /^[A-Z0-9-]{3,8}$/.test(airport.id)
    && typeof airport.code === 'string' && /^[A-Z0-9]{3,4}$/.test(airport.code)
    && typeof airport.name === 'string' && !!airport.name.trim() && airport.name.length <= 300
    && (airport.country == null || typeof airport.country === 'string' && /^[A-Z]{2}$/.test(airport.country));
}

const validRecordedTime = value => Number.isFinite(value) && Number.isFinite(new Date(value).getTime());

function validRecordedRound(round) {
  const aircraft = round?.aircraft, route = round?.route;
  return round?.mode === 'practice' && validRecordedTime(round.recordedAt)
    && validCoordinates(aircraft) && validRecordedTime(aircraft.positionObservedAt)
    && Number.isFinite(aircraft.track) && aircraft.track >= 0 && aircraft.track < 360
    && Number.isFinite(aircraft.distanceFromPlaceKm) && aircraft.distanceFromPlaceKm >= 0
    && typeof aircraft.callsign === 'string' && /^[A-Z]{3}\d[A-Z0-9]{0,6}$/.test(aircraft.callsign)
    && validLocalAirport(route?.origin) && validLocalAirport(route?.destination)
    && route.origin.id !== route.destination.id && route.callsign === aircraft.callsign
    && ['adsb.lol', 'adsbdb'].includes(route.provider)
    && typeof round.place?.name === 'string' && !!round.place.name.trim();
}

async function loadLocalArray(path, code, message, validEntry) {
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(10000), credentials: 'omit' });
    if (!response.ok) throw new Error('Unavailable data file');
    const data = await response.json();
    if (!Array.isArray(data) || !data.length || !data.every(validEntry)) throw new Error('Invalid data file');
    return data;
  } catch {
    // Missing, corrupt, and timed-out bundled files need the same useful recovery
    // message; parser and network errors are implementation details.
    throw new DataError(code, message);
  }
}

function loadAirports() {
  return airportPromise ??= loadLocalArray('./data/airports.json', 'airports', 'The city list could not be loaded. Try again.',
    validLocalAirport)
    .catch(error => { airportPromise = null; throw error; });
}

function destinationResolver(airports) {
  const airportById = new Map(airports.map(airport => [airport.id, airport]));
  return endpoint => {
    const indexed = airportById.get(endpoint.id);
    return hasMunicipality(endpoint) || !hasMunicipality(indexed) ? endpoint : { ...endpoint, city: indexed.city };
  };
}

async function openRound(round, token) {
  const airportsReady = loadAirports();
  // The map library and city list are needed only once a round opens. Load them
  // together; the welcome screen needs neither dataset.
  // A failed optional map still leaves the compass and all game clues usable.
  globePromise ??= import('./globe.js').catch(() => ({ globeHTML: () => '' }));
  const [airports, globe] = await Promise.all([airportsReady, globePromise]);
  if (token !== generation) return;
  globeHTML = globe.globeHTML;
  const mergedAirports = mergeRouteAirports(airports, round.route);
  const cityEndpoint = endpoint => endpoint ? { ...endpoint, city: mergedAirports.find(airport => airport.id === endpoint.id)?.city ?? endpoint.city } : endpoint;
  let game;
  try {
    game = createGame({ ...round, route: { ...round.route, origin: cityEndpoint(round.route.origin), destination: cityEndpoint(round.route.destination) } }, { difficulty });
  } catch {
    throw new DataError('city', 'This reported airport has no usable city name. Try another flight or a recorded round.');
  }
  state = { view: 'game', game, cityIndex: indexCities(mergedAirports), selected: null, query: '', results: [], activeResult: -1, clueBookOpen: true };
  // Commit only after the new round is playable; cancelled and failed searches
  // leave the previous destination available for the next exclusion check.
  lastDestinationIds = new Set(destinationRepeatIds(game.round.route.destination, game.destination));
  selectionHistory = rememberSelection(selectionHistory, game.round);
  renderGame();
  focusHeading();
  announce(`${round.mode === 'practice' ? 'Recorded practice round' : 'Live flight snapshot'}. ${game.difficulty === 'hard' ? 'Hard' : 'Normal'} difficulty. Guess the destination city. Six guesses. Linked cities served by the reported airport also count.`);
}

function observationLabel(round) {
  if (round.mode === 'practice') return `Recorded ${new Date(round.recordedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} · near ${round.place.name}`;
  const minutes = Math.floor((Date.now() - round.aircraft.positionObservedAt) / 60000);
  return `Observed ${minutes <= 0 ? 'just now' : `${minutes} min ago`} · ${round.place.kind === 'device' ? 'near you' : `near ${round.place.name}`}`;
}

function observationHTML(game) {
  const clue = game.clues[0];
  const finished = game.status !== 'playing';
  const globe = globeHTML(game.round.aircraft, finished ? { route: game.round.route } : {});
  const graphic = globe || `<div class="compass" role="img" aria-label="${escape(clue.title === 'Current heading' ? 'Current true heading' : clue.title)} ${degrees(clue.heading)} degrees ${escape(clue.direction)}" style="--heading:${clue.heading}deg"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5L35 39L24 33L13 39Z" fill="currentColor"/></svg></div>`;
  return `<div class="observation-graphic">${graphic}${finished && globe ? '<p class="globe-caption">Reported route · schematic</p>' : ''}</div>`;
}

function bookClueHTML(clue, index, game) {
  const label = index === 0 ? `First clue · ${clue.title}` : `Clue ${index + 1} · ${clue.title}`;
  const directions = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };
  let value = clue.value;
  let detail = '';
  if (clue.kind === 'direction') {
    value = `The plane is currently ${clue.title === 'Current heading' ? 'heading' : 'travelling'} ${directions[clue.direction] ?? clue.direction} · ${degrees(clue.heading)}°.`;
    detail = clue.detail;
  } else if (clue.title === 'Distance & direction') {
    const firstCity = game.guesses.find(guess => guess.city)?.city;
    value = `${clue.value.replace(' · ', ' ')} from ${cityLabel(firstCity)}.`;
    detail = 'Straight-line estimate to the main destination city.';
  } else if (clue.title === 'Distance remaining') {
    value = `${clue.value} from the plane to the destination city.`;
    detail = clue.detail;
  } else if (clue.title === 'Destination country') value = `The destination is in ${clue.value}.`;
  else if (clue.title === 'City initial') value = clue.detail;
  else if (clue.title === 'Airline') value = `${clue.value}.`;
  else detail = clue.detail;
  return `<div class="book-clue" id="history-clue-${index}" role="group" aria-labelledby="book-clue-label-${index}" tabindex="-1"><dt class="clue-label" id="book-clue-label-${index}">${escape(label)}</dt><dd><p class="clue-value">${escape(value)}</p>${detail ? `<p class="clue-detail">${escape(detail)}</p>` : ''}</dd></div>`;
}

function clueBookHTML(game) {
  const finished = game.status !== 'playing';
  const visible = finished ? game.clues : game.clues.slice(0, game.clueIndex + 1);
  const expanded = !phoneLayout.matches || state.clueBookOpen;
  return `<section class="clue-book" aria-labelledby="clue-book-title">
    <div class="clue-book-header"><h2 id="clue-book-title">Clue book</h2><div class="clue-book-actions"><span class="clue-count">${visible.length} ${visible.length === 1 ? 'clue' : 'clues'}</span><button class="clue-toggle" id="clue-book-toggle" type="button" data-action="toggle-clues" aria-controls="clue-book-content" aria-expanded="${expanded}"><span>${expanded ? 'Hide clues' : 'Show clues'}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6L8 10L12 6"/></svg></button></div></div>
    <div id="clue-book-content" ${expanded ? '' : 'hidden'}><dl class="clue-list">${visible.map((clue, index) => bookClueHTML(clue, index, game)).join('')}</dl>
    ${!finished && game.clueIndex < game.clues.length - 1 ? '<button class="text-button reveal-clue" data-action="clue">Reveal next clue <span aria-hidden="true">→</span></button>' : ''}</div>
  </section>`;
}

function syncClueBook() {
  const content = app.querySelector('#clue-book-content');
  const toggle = app.querySelector('#clue-book-toggle');
  if (!content || !toggle) return;
  const expanded = !phoneLayout.matches || state.clueBookOpen;
  // Responsive changes must not leave keyboard focus inside hidden content.
  if (!expanded && content.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  content.hidden = !expanded;
  if (!phoneLayout.matches && document.activeElement === toggle) content.querySelector('.book-clue')?.focus({ preventScroll: true });
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.querySelector('span').textContent = expanded ? 'Hide clues' : 'Show clues';
}
phoneLayout.addEventListener('change', syncClueBook);

function plainClue(clue) {
  if (clue.kind === 'direction') return `First clue · ${clue.title === 'Current heading' ? 'Current true heading' : clue.title}: ${degrees(clue.heading)}° ${clue.direction}. ${clue.detail}`;
  return `${clue.title}: ${clue.value}. ${clue.detail}`;
}

function renderGame() {
  app.setAttribute('aria-busy', 'false');
  const game = state.game;
  const round = game.round;
  const finished = game.status !== 'playing';
  const roundMeta = `<div class="round-meta">${round.mode === 'practice' ? '<span class="badge practice">Practice</span>' : ''}<span class="badge">${game.difficulty === 'hard' ? 'Hard' : 'Normal'}</span><span>${escape(round.mode === 'practice' ? observationLabel(round) : `Near ${round.place.kind === 'device' ? 'you' : round.place.name}`)}</span></div>`;
  app.innerHTML = `<section class="game${finished ? ' finished' : ''}">
    ${roundMeta}
    ${finished ? endHTML(game) : '<h1>Where is it going?</h1>'}
    ${observationHTML(game)}
    <div class="round-layout">
    ${finished ? '' : `<form class="guess-form" id="guess-form" autocomplete="off">
      <div class="guess-form-title"><label for="destination-input">Destination city</label><span class="guesses-left">${MAX_GUESSES - game.guesses.length} ${game.guesses.length === MAX_GUESSES - 1 ? 'guess' : 'guesses'} left</span></div>
      <div class="input-row"><div class="input-wrap"><input id="destination-input" type="text" value="${escape(state.query)}" placeholder="City or airport" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="destination-results" aria-describedby="input-message" spellcheck="false" autocapitalize="off" autocorrect="off" maxlength="100"><button class="clear-input" type="button" data-action="clear" aria-label="Clear city search" ${state.query ? '' : 'hidden'}>×</button>
      <ul id="destination-results" class="search-results" role="listbox" aria-label="Matching destination cities" tabindex="-1" hidden></ul></div><button class="button primary" type="submit" id="guess-button">Guess</button></div>
      <p class="input-message" id="input-message" aria-live="polite">${state.selected ? `${escape(cityLabel(state.selected))}, ${escape(countryName(state.selected.country))}. Ready to guess.` : ''}</p></form>`}
    ${clueBookHTML(game)}
    <ol class="board" aria-label="Six destination guesses">${Array.from({ length: MAX_GUESSES }, (_, index) => guessHTML(game.guesses[index], index)).join('')}</ol>
    </div></section>`;
  if (!finished && state.query && !state.selected) updateResults();
}

function guessHTML(guess, index) {
  if (!guess) return `<li class="guess-row empty" aria-label="Guess ${index + 1}, unused"><span class="guess-number">${index + 1}</span><span aria-hidden="true"></span><span aria-hidden="true"></span></li>`;
  if (guess.kind === 'clue') return `<li class="guess-row clue-used" id="guess-row-${index + 1}" tabindex="-1" aria-label="Guess ${index + 1}, used to reveal a clue"><span class="guess-number">${index + 1}</span><span class="guess-name">Clue revealed</span><span aria-hidden="true"></span></li>`;
  return `<li class="guess-row ${guess.correct ? 'correct' : ''}" id="guess-row-${index + 1}" tabindex="-1"><span class="guess-number">${index + 1}</span>
    <span class="guess-name">${escape(cityLabel(guess.city))}</span>
    <span class="guess-feedback">${guess.correct ? '✓ Correct' : 'Miss'}</span></li>`;
}

function endHTML(game) {
  const round = game.round;
  const destination = round.route.destination;
  const answer = game.status === 'won' ? game.guesses.at(-1).city : game.destination.primary;
  const otherCities = game.destination.accepted.filter(city => city.id !== answer.id);
  return `<section class="round-end" aria-label="Round result" tabindex="-1"><h1>${game.status === 'won' ? `Found it in ${game.guesses.length} ${game.guesses.length === 1 ? 'guess' : 'guesses'}.` : 'Destination revealed.'}</h1>
    <p class="clue-label">Destination city</p><p class="destination">${escape(cityLabel(answer))}</p>
    <p class="clue-detail">${escape(destination.name)} (${escape(destination.code)}) · ${escape(countryName(destination.country))}</p>
    ${otherCities.length ? `<p class="note">Also accepted: ${otherCities.map(city => escape(cityLabel(city))).join(', ')}.</p>` : ''}
    <p class="route-note">${escape(round.aircraft.callsign)} · ${escape(airportLabel(round.route.origin))} → ${escape(destination.code)}</p>
    ${difficultyHTML('Next round difficulty')}
    <button class="button primary" data-action="next">${round.mode === 'practice' ? 'Another recorded flight' : 'Find another flight'}</button>
    <div class="round-options"><button class="text-button" data-action="cities">Choose a city</button><button class="text-button" data-action="home">Back to start</button></div></section>`;
}

function updateResults() {
  const input = app.querySelector('#destination-input');
  const list = app.querySelector('#destination-results');
  if (!input || !list) return;
  state.results = searchCities(state.cityIndex, state.query);
  state.activeResult = -1;
  list.innerHTML = state.results.map((city, index) => `<li id="destination-result-${index}" role="option" aria-selected="false" data-result="${index}"><span class="airport-city">${escape(cityLabel(city))}</span><span class="airport-code">${escape(city.country)}</span><span class="airport-name">${escape(countryName(city.country))}${city.fallback ? ` · ${escape(city.airportName)} (${escape(city.airportCode)})` : ''}</span></li>`).join('');
  list.hidden = !state.query.trim() || !state.results.length || !!state.selected;
  input.setAttribute('aria-expanded', String(!list.hidden));
  input.removeAttribute('aria-activedescendant');
  positionResults();
  if (state.query.trim() && !state.results.length) setMessage('No cities found. Try a city or airport code.');
  else if (!state.selected) {
    const total = state.results.total;
    setMessage(state.query.trim() ? `${total > state.results.length ? `Showing ${state.results.length} of ${total}` : total} matching ${total === 1 ? 'city' : 'cities'}. Choose one.` : '');
  }
}

function positionResults() {
  const list = app.querySelector('#destination-results');
  const input = app.querySelector('#destination-input');
  if (!input || !list || list.hidden) return;
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const bottom = top + (viewport?.height ?? innerHeight);
  const rect = input.getBoundingClientRect();
  const below = Math.max(0, bottom - rect.bottom - 12);
  const above = Math.max(0, rect.top - top - 12);
  const flip = below < 150 && above > below;
  list.style.top = flip ? 'auto' : '100%';
  list.style.bottom = flip ? 'calc(100% + 6px)' : 'auto';
  list.style.maxHeight = `${Math.max(58, Math.min(295, flip ? above : below))}px`;
}

addEventListener('resize', positionResults);
addEventListener('scroll', positionResults, { passive: true });
window.visualViewport?.addEventListener('resize', positionResults);
window.visualViewport?.addEventListener('scroll', positionResults);

function setMessage(message, error = false) {
  const node = app.querySelector('#input-message');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error-message', error);
}

function chooseResult(index) {
  const city = state.results[index];
  if (!city) return;
  state.selected = city;
  state.query = cityLabel(city);
  const input = app.querySelector('#destination-input');
  input.value = state.query;
  hideResults();
  app.querySelector('.clear-input').hidden = false;
  setMessage(`${cityLabel(city)}, ${countryName(city.country)}. Ready to guess.`);
  input.focus({ preventScroll: true });
}

function clearInput() {
  state.selected = null; state.query = ''; state.results = []; state.activeResult = -1;
  const input = app.querySelector('#destination-input');
  if (!input) return;
  input.value = '';
  app.querySelector('.clear-input').hidden = true;
  updateResults();
  input.focus({ preventScroll: true });
}

function makeGuess() {
  const result = submitGuess(state.game, state.selected);
  if (!result.accepted) {
    const message = result.reason === 'duplicate' ? 'You’ve already tried this city. Choose another.' : 'Choose a city or airport first.';
    setMessage(message, true); return;
  }
  state.selected = null; state.query = ''; state.results = []; state.activeResult = -1;
  if (Number.isInteger(result.guess.clueIndex) || state.game.status !== 'playing') state.clueBookOpen = true;
  renderGame();
  const game = state.game;
  const resultText = result.guess.correct ? `Correct. ${cityLabel(result.guess.city)} counts. Reported airport: ${game.round.route.destination.name} (${game.round.route.destination.code}).`
    : `${cityLabel(result.guess.city)} was not the answer. ${game.status === 'lost' ? `The answer was ${cityLabel(game.destination.primary)}.` : `${Number.isInteger(result.guess.clueIndex) ? `Clue ${game.clueIndex + 1} of ${game.clues.length} revealed. ${plainClue(game.clues[game.clueIndex])} ` : ''}${MAX_GUESSES - game.guesses.length} ${game.guesses.length === MAX_GUESSES - 1 ? 'guess' : 'guesses'} left.`}`;
  announce(resultText);
  if (game.status === 'playing') {
    if (keyboardInteraction || matchMedia('(pointer: fine)').matches) app.querySelector('#destination-input').focus();
    else focusRevealedClue();
  }
  if (game.status !== 'playing') focusRoundResult();
}

function focusRoundResult() {
  app.querySelector('.round-end').focus({ preventScroll: true });
  app.querySelector('.game').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}

function focusRevealedClue() {
  const game = state.game;
  const latest = game.guesses.at(-1);
  const target = app.querySelector(`#history-clue-${latest.clueIndex}`) ?? app.querySelector(`#guess-row-${game.guesses.length}`);
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: 'instant', block: 'nearest' });
}

app.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'city-form') {
    const value = app.querySelector('#city-select').value;
    if (value === '') return;
    startSearch({ ...cities[Number(value)], kind: 'city' });
  } else if (event.target.id === 'guess-form') makeGuess();
});

app.addEventListener('click', event => {
  const result = event.target.closest('[data-result]');
  if (result) return chooseResult(Number(result.dataset.result));
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action || ({ 'location-button': 'location', 'place-button': 'cities' })[button.id];
  if (action === 'location') locate();
  if (action === 'cities') { invalidatePending(); renderCities(); }
  if (action === 'home' || action === 'cancel') cancel();
  if (action === 'practice') practice();
  if (action === 'elsewhere') lookElsewhere();
  if (action === 'retry' && lastPlace && Date.now() >= (state.retryAt ?? 0)) startSearch(lastPlace);
  if (action === 'clear') clearInput();
  if (action === 'clue') nextClue();
  if (action === 'toggle-clues' && phoneLayout.matches) { state.clueBookOpen = !state.clueBookOpen; syncClueBook(); }
  if (action === 'next') state.game.round.mode === 'practice' ? practice() : startSearch(state.game.round.place);
});

function nextClue() {
  if (!state.game || !revealClue(state.game)) return false;
  state.clueBookOpen = true;
  renderGame();
  const game = state.game;
  const remaining = MAX_GUESSES - game.guesses.length;
  if (game.status !== 'playing') focusRoundResult();
  else focusRevealedClue();
  announce(`One guess used. Clue ${game.clueIndex + 1} of ${game.clues.length} revealed. ${plainClue(game.clues[game.clueIndex])} ${remaining} ${remaining === 1 ? 'guess' : 'guesses'} left.${game.status === 'lost' ? ` Destination city: ${cityLabel(game.destination.primary)}.` : ''}`);
  return true;
}

app.addEventListener('change', event => {
  if (event.target.id === 'difficulty-select') setDifficulty(event.target.value);
});

app.addEventListener('input', event => {
  if (event.target.id !== 'destination-input') return;
  // Editing the label clears the selected city ID; free text is never a guess.
  state.query = event.target.value; state.selected = null;
  app.querySelector('.clear-input').hidden = !state.query;
  updateResults();
});

app.addEventListener('pointerdown', () => { keyboardInteraction = false; });
app.addEventListener('keydown', event => {
  keyboardInteraction = true;
  if (event.target.id !== 'destination-input') return;
  const input = event.target;
  const list = app.querySelector('#destination-results');
  if (event.key === 'Escape') {
    hideResults(); return;
  }
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && state.results.length && !state.selected) {
    event.preventDefault(); list.hidden = false; input.setAttribute('aria-expanded', 'true');
    positionResults();
    const previous = list.children[state.activeResult];
    state.activeResult = state.activeResult < 0 ? (event.key === 'ArrowDown' ? 0 : state.results.length - 1)
      : event.key === 'ArrowDown' ? (state.activeResult + 1) % state.results.length : (state.activeResult - 1 + state.results.length) % state.results.length;
    previous?.setAttribute('aria-selected', 'false');
    list.children[state.activeResult].setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', `destination-result-${state.activeResult}`);
    list.children[state.activeResult].scrollIntoView({ block: 'nearest' });
  }
  if (event.key === 'Enter' && !state.selected && !list.hidden && state.activeResult >= 0) {
    event.preventDefault(); chooseResult(state.activeResult);
  }
});

function hideResults() {
  const list = app.querySelector('#destination-results');
  const input = app.querySelector('#destination-input');
  if (!list || !input) return;
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

document.addEventListener('click', event => {
  if (!event.target.closest('.input-wrap')) hideResults();
});

function showInfo(kind) {
  const title = document.querySelector('#info-title');
  const content = document.querySelector('#info-content');
  if (kind === 'help') {
    title.textContent = 'How to play';
    content.innerHTML = '<ol><li>Choose Normal or Hard mode, then find a nearby flight or choose a starting city. Your starting place is where we look for a plane, not where it took off.</li><li>Search for its destination city, select it and press Guess. You have six tries.</li><li>Your first missed city guess reveals one combined distance-and-direction clue from that city to the main destination city. It stays fixed in the clue book. Later misses reveal the next clue without adding new distance or direction readings.</li></ol><p>Current heading describes the plane at the observation. It can turn before arrival.</p><p>Normal mode gives kilometre values; Hard mode gives ranges for both destination distances. Difficulty stays fixed for the round.</p><p>All clues, including the first direction clue, are in the clue book. On phone, you can hide or show the book; a new clue reopens it.</p><p>After your first miss, the clues give destination country, distance remaining, airline when available, then a city initial. Missing facts are skipped.</p><p>Seoul and Incheon both count for Incheon Airport. Tokyo counts for Haneda and Narita. Other linked cities served by the reported airport also count.</p><p>Revealing an extra clue uses one guess and fills a line on your guess board. Routes come from a database and can be wrong; the reported airport is shown at the end.</p><p>If live data is unavailable, you can play a recorded flight. These rounds are labelled “Practice”.</p>';
  } else {
    title.textContent = 'About the data';
    const round = state.view === 'game' ? state.game.round : null;
    content.innerHTML = `<p>Aircraft positions and flight clues come from <a href="https://www.adsb.lol/docs/open-data/api/" target="_blank" rel="noopener noreferrer">adsb.lol</a> under ODbL 1.0. Routes use adsb.lol, with <a href="https://www.adsbdb.com/" target="_blank" rel="noopener noreferrer">adsbdb</a> if a lookup is unavailable. Airline names also use adsbdb when available. Routes match a flight identifier, called a callsign, to airports. These database matches can be stale or wrong; they aren’t confirmed flight plans.</p>
      <p>We skip positions over a minute old, unclear routes and routes with stops. Each round keeps its original observation, so the position and answer stay fixed while you play.</p>
      <h3>What the clues mean</h3><p>Current heading shows where the aircraft’s nose points at the observation. When it isn’t reported, current direction of travel shows its movement over the ground. The plane can turn before arrival; the starting place is the observation area, not its departure point. An airline clue uses the operating airline reported for the flight, when its name is available. Distance remaining is a straight-line estimate to the main destination city; the actual flight path may be longer. The combined distance-and-direction clue starts at your first guessed city and stays fixed. The other clues give the destination country and the first letter of an accepted city.</p>
      <h3>Distances and map</h3><p>Guess feedback points from your chosen city toward the main destination city. The distance clue runs from the aircraft to that city. Both use straight-line distances to city reference points; where city coordinates are unavailable, we use an airport position. Normal mode gives kilometre values and Hard mode gives distance ranges. We don’t estimate arrival times.</p>
      <p>Linked cities can also count as correct. The reported route and globe use the exact airports. The dotted line appears after the round and illustrates the reported route; it isn’t a recorded flight path.</p>
      ${round ? `<h3>This round</h3><p>${escape(round.mode === 'practice' ? 'Recorded practice observation' : 'Aircraft observed')} ${escape(new Date(round.aircraft.positionObservedAt).toLocaleString('en-GB', { timeZone: 'UTC' }))} UTC. Route source: ${escape(round.route.provider)}.</p>` : ''}
      <h3>Your location</h3><p>Permission is requested only when you press “Use my location”. Approximate coordinates are sent to the aircraft provider. This game doesn’t save your location or use analytics. Providers may keep their own request logs.</p>
      <p>Airport names and coordinates come from <a href="https://ourairports.com/data/" target="_blank" rel="noopener noreferrer">OurAirports</a>, public-domain data via datasets/airport-codes. A small curated list links airports to the cities they serve. Other places use the town or city listed for the airport.</p>`;
  }
  dialog.showModal();
}
document.querySelector('#help-button').addEventListener('click', () => showInfo('help'));
document.querySelector('#data-button').addEventListener('click', () => showInfo('data'));
document.querySelector('#close-info').addEventListener('click', () => dialog.close());
document.querySelector('#info-done').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });

// Optional proposed browser API. These actions use the same state as the UI;
// the hidden answer and precise device coordinates are never exposed while playing.
function visibleGameState() {
  if (state.view !== 'game') return { view: state.view, difficulty };
  const game = state.game;
  return {
    view: 'game', mode: game.round.mode, difficulty: game.difficulty, nextDifficulty: difficulty, observation: observationLabel(game.round),
    status: game.status, guessesLeft: MAX_GUESSES - game.guesses.length, extraClues: game.assistance,
    clues: (game.status === 'playing' ? game.clues.slice(0, game.clueIndex + 1) : game.clues).map(plainClue),
    guesses: game.guesses.map(guess => {
      const revealed = Number.isInteger(guess.clueIndex) ? { clue: plainClue(game.clues[guess.clueIndex]) } : {};
      return guess.kind === 'clue' ? { kind: 'clue', ...revealed } : { city: cityLabel(guess.city), country: countryName(guess.city.country), correct: guess.correct, ...revealed };
    }),
    ...(game.status !== 'playing' ? { destinationCity: cityLabel(game.status === 'won' ? game.guesses.at(-1).city : game.destination.primary), acceptedCities: game.destination.accepted.map(cityLabel), reportedAirport: airportLabel(game.round.route.destination), routeSource: game.round.route.provider } : {}),
  };
}

function toolString(input, key) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => name !== key)
    || typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 100) throw new Error(`Provide a valid ${key}.`);
  return input[key].trim();
}

function registerGameTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const empty = { type: 'object', properties: {}, additionalProperties: false };
  const stringSchema = key => ({ type: 'object', properties: { [key]: { type: 'string', minLength: 1, maxLength: 100 } }, required: [key], additionalProperties: false });
  const tools = [
    { name: 'read_game_state', description: 'Read the visible round, revealed clues and guess history. Does not reveal a hidden answer or device coordinates.', inputSchema: empty, readOnly: true, execute: visibleGameState },
    { name: 'set_difficulty', description: 'Choose normal or hard difficulty for the next round. Hard mode gives destination distance ranges. Available before starting or after finishing a round; never changes a playing round.', inputSchema: { type: 'object', properties: { difficulty: { type: 'string', enum: DIFFICULTIES } }, required: ['difficulty'], additionalProperties: false }, execute: input => {
      setDifficulty(toolString(input, 'difficulty')); return visibleGameState();
    } },
    { name: 'start_practice_round', description: 'Start a clearly labelled recorded real-flight practice round. Replaces any current round; never uses device location.', inputSchema: empty, execute: async () => { await practice(); return visibleGameState(); } },
    { name: 'start_city_round', description: 'Choose a starting city and search for a live flight nearby. This sets the observation place, not a destination guess. Sends city coordinates to the aircraft provider and replaces the current round.', inputSchema: stringSchema('city'), execute: async input => {
      const name = toolString(input, 'city');
      const city = cities.find(value => value.name.toLowerCase() === name.toLowerCase());
      if (!city) throw new Error(`Choose one of: ${cities.map(value => value.name).join(', ')}.`);
      await startSearch({ ...city, kind: 'city' }); return visibleGameState();
    } },
    { name: 'search_cities', description: 'Search the same local destination-city picker by city, country, airport name or code. Returns city IDs and an honest total. Requires an open round.', inputSchema: stringSchema('query'), readOnly: true, execute: input => {
      const query = toolString(input, 'query');
      if (state.view !== 'game') throw new Error('Open a round first.');
      const matches = searchCities(state.cityIndex, query);
      return { cities: matches.map(({id,name,country,region,fallback,airportCode,airportName}) => ({id,name,country,...(region ? {region} : {}),...(fallback ? {airportCode,airportName} : {})})), total: matches.total };
    } },
    { name: 'submit_city_guess', description: 'Select and submit a city ID from search_cities. Linked cities served by the reported airport also count. A valid new city consumes one of six attempts; invalid or duplicate guesses do not.', inputSchema: stringSchema('cityId'), execute: input => {
      const id = toolString(input, 'cityId');
      if (state.view !== 'game' || state.game.status !== 'playing') throw new Error('Open a playing round first.');
      const city = state.cityIndex.find(value => value.id === id);
      if (!city) throw new Error('Choose a valid city from the search results.');
      if (state.game.guesses.some(guess => guess.city?.id === id)) throw new Error('This city has already been guessed.');
      state.results = [city]; chooseResult(0); makeGuess(); return visibleGameState();
    } },
    { name: 'reveal_next_clue', description: 'Reveal the next clue using one of six guesses and mark that guess-board line as used. Ends the round if no guesses remain.', inputSchema: empty, execute: () => {
      if (state.view !== 'game' || !nextClue()) throw new Error('No further clue is available in this round.');
      return visibleGameState();
    } },
  ];
  for (const { readOnly = false, ...tool } of tools) {
    try { Promise.resolve(context.registerTool({ ...tool, annotations: { readOnlyHint: readOnly, untrustedContentHint: true } }, { signal: lifecycle.signal })).catch(() => {}); }
    catch { /* Optional capability: unsupported browsers keep the regular game. */ }
  }
  addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
registerGameTools();
