import { searchCities } from './destinations.js';

// Optional browser tools call the same guarded actions as the visible controls.
function toolString(input, key) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => name !== key)
    || typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 100) throw new Error(`Provide a valid ${key}.`);
  return input[key].trim();
}

export function registerGameTools({ getState, visibleGameState, practice, startSearch, cities, guessCity, nextClue, context = document.modelContext }) {
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const state = () => getState();
  const empty = { type: 'object', properties: {}, additionalProperties: false };
  const stringSchema = key => ({ type: 'object', properties: { [key]: { type: 'string', minLength: 1, maxLength: 100 } }, required: [key], additionalProperties: false });
  const tools = [
    { name: 'read_game_state', description: 'Read the visible round, revealed clues and guess history. Does not reveal a hidden answer or device coordinates.', inputSchema: empty, readOnly: true, execute: visibleGameState },
    { name: 'start_practice_round', description: 'Start a clearly labelled recorded real-flight practice round. Replaces any current round; never uses device location.', inputSchema: empty, execute: async () => { await practice(); return visibleGameState(); } },
    { name: 'start_city_round', description: 'Choose a starting city and search for a live flight nearby. This sets the observation place, not a destination guess. Sends city coordinates to the aircraft provider and replaces the current round.', inputSchema: stringSchema('city'), execute: async input => {
      const name = toolString(input, 'city');
      const city = cities.find(value => value.name.toLowerCase() === name.toLowerCase());
      if (!city) throw new Error(`Choose one of: ${cities.map(value => value.name).join(', ')}.`);
      await startSearch({ ...city, kind: 'city' }); return visibleGameState();
    } },
    { name: 'search_cities', description: 'Search the same local destination-city picker by city, country, airport name or code. Returns city IDs and an honest total. Requires an open round.', inputSchema: stringSchema('query'), readOnly: true, execute: input => {
      const query = toolString(input, 'query');
      if (state().view !== 'game') throw new Error('Open a round first.');
      const matches = searchCities(state().cityIndex, query);
      return { cities: matches.map(({id,name,country,region,fallback,airportCode,airportName}) => ({id,name,country,...(region ? {region} : {}),...(fallback ? {airportCode,airportName} : {})})), total: matches.total };
    } },
    { name: 'submit_city_guess', description: 'Select and submit a city ID from search_cities. Linked cities served by the reported airport also count. A valid new city consumes one of six attempts; invalid or duplicate guesses do not.', inputSchema: stringSchema('cityId'), execute: input => {
      const id = toolString(input, 'cityId');
      if (state().view !== 'game' || state().game.status !== 'playing') throw new Error('Open a playing round first.');
      const city = state().cityIndex.find(value => value.id === id);
      if (!city) throw new Error('Choose a valid city from the search results.');
      if (state().game.guesses.some(guess => guess.city?.id === id)) throw new Error('This city has already been guessed.');
      guessCity(city); return visibleGameState();
    } },
    { name: 'reveal_next_clue', description: 'Reveal the next clue using one of six guesses and mark that guess-board line as used. Ends the round if no guesses remain.', inputSchema: empty, execute: () => {
      if (state().view !== 'game' || !nextClue()) throw new Error('No further clue is available in this round.');
      return visibleGameState();
    } },
  ];
  for (const { readOnly = false, ...tool } of tools) {
    try { Promise.resolve(context.registerTool({ ...tool, annotations: { readOnlyHint: readOnly, untrustedContentHint: true } }, { signal: lifecycle.signal })).catch(() => {}); }
    catch { /* Optional capability: unsupported browsers keep the regular game. */ }
  }
  addEventListener('pagehide', event => { if (!event.persisted) lifecycle.abort(); });
}
