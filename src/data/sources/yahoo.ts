import type { ProjectionSource } from './types';

/**
 * Yahoo's fantasy API requires OAuth through a registered server
 * application. FootBud runs entirely in the browser, so there is nowhere to
 * complete that handshake yet. The source exists so the UI can say so
 * honestly, and so a future server or extension can light it up without
 * touching the rest of the app.
 */
export const yahooSource: ProjectionSource = {
  id: 'yahoo',
  label: 'Yahoo',
  description: 'Yahoo requires a sign-in server FootBud does not have yet.',
  availability: 'unavailable',
  fetchPlayers() {
    return Promise.reject(
      new Error(
        'Yahoo requires OAuth sign-in through a server, which FootBud (a browser-only app) does not have yet. Export your Yahoo projections as a CSV and use Upload CSV, or use Sleeper.',
      ),
    );
  },
};
