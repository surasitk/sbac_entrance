/* ────────────────────────────────────────────────────────────────────────
 * Configuration for the QR check-in load test.
 * Everything here is overridable from the command line with -e KEY=value.
 * ──────────────────────────────────────────────────────────────────────── */

// Read an env var with a default.
const E = (key, fallback) => (__ENV[key] !== undefined ? __ENV[key] : fallback);

// --- Target system --------------------------------------------------------
const BASE_URL = E('BASE_URL', 'https://api.sharering.network'); // <-- set to the real ShareRing host
const CHECKIN_PATH = E('CHECKIN_PATH', '/v1/checkin');           // <-- set to the real check-in endpoint
const AUTH_TOKEN = E('AUTH_TOKEN', '');                          // bearer token, if the API needs one
const EVENT_ID = E('EVENT_ID', 'sbac-2026');                     // event identifier, if the API needs one

// --- Load profile ---------------------------------------------------------
const TARGET_RPS = parseInt(E('TARGET_RPS', '400'), 10);  // peak requests/second
const RAMP_SECONDS = parseInt(E('RAMP_SECONDS', '5'), 10); // seconds to reach peak (burst = small)
const HOLD_SECONDS = parseInt(E('HOLD_SECONDS', '5'), 10); // seconds held at peak
const MAX_VUS = parseInt(E('MAX_VUS', '600'), 10);        // ceiling on concurrent virtual users

// --- Data -----------------------------------------------------------------
const QR_DATA_FILE = E('QR_DATA_FILE', './data/qr-codes.json');

// --- Scenario definitions -------------------------------------------------
// "burst" (default): everyone scans at gate-open. Ramps to TARGET_RPS fast,
//   holds briefly. With ~700 codes at 400 rps the whole crowd clears in ~2s.
// Pick a scenario with: -e SCENARIO=burst | sustained | stress
const SCENARIO = E('SCENARIO', 'burst');

const ALL_SCENARIOS = {
  burst: {
    executor: 'ramping-arrival-rate',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: Math.min(MAX_VUS, TARGET_RPS),
    maxVUs: MAX_VUS,
    stages: [
      { target: TARGET_RPS, duration: `${RAMP_SECONDS}s` }, // ramp up fast
      { target: TARGET_RPS, duration: `${HOLD_SECONDS}s` }, // hold at peak
      { target: 0, duration: '2s' },                        // ramp down
    ],
  },

  sustained: {
    executor: 'constant-arrival-rate',
    rate: TARGET_RPS,
    timeUnit: '1s',
    duration: '60s',
    preAllocatedVUs: Math.min(MAX_VUS, TARGET_RPS),
    maxVUs: MAX_VUS,
  },

  stress: {
    executor: 'ramping-arrival-rate',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: MAX_VUS,
    stages: [
      { target: TARGET_RPS, duration: '15s' },
      { target: TARGET_RPS * 2, duration: '15s' }, // push past expected peak
      { target: TARGET_RPS * 3, duration: '15s' }, // find the breaking point
      { target: 0, duration: '5s' },
    ],
  },
};

// --- Request shape --------------------------------------------------------
const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;

export const CONFIG = {
  baseUrl: BASE_URL,
  checkinPath: CHECKIN_PATH,
  qrDataFile: QR_DATA_FILE,
  requestTimeout: '15s',
  headers: headers,
  scenarios: { [SCENARIO]: ALL_SCENARIOS[SCENARIO] },

  // Build the POST body from a QR code. EDIT THIS to match ShareRing's API.
  buildBody: (qr) => ({
    eventId: EVENT_ID,
    qr: qr,
    scannedAt: new Date().toISOString(),
  }),

  // Decide whether a response means "this QR was already used".
  // EDIT THIS to match how ShareRing signals a duplicate (status code or body).
  isDuplicate: (res) => {
    if (res.status === 409) return true;
    try {
      const body = res.json();
      return body && /already|duplicate|used/i.test(JSON.stringify(body));
    } catch (e) {
      return false;
    }
  },
};
