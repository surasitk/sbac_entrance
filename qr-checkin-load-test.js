import http from 'k6/http';
import exec from 'k6/execution';
import { check, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { CONFIG } from './config.js';

/* ────────────────────────────────────────────────────────────────────────
 * SBAC Entrance — QR Check-in Load Test (k6)
 *
 * Scenario: ~700 attendees scan their QR code at the gate. At event-open
 * everyone arrives at once, so this defaults to a BURST profile that ramps
 * to TARGET_RPS (default 400 req/s) within a few seconds and holds.
 *
 * Run:
 *   k6 run qr-checkin-load-test.js
 *   k6 run -e TARGET_RPS=400 -e BASE_URL=https://staging.example.com qr-checkin-load-test.js
 * ──────────────────────────────────────────────────────────────────────── */

/* ---- 1. Load QR codes (each attendee = one unique code) ---------------- */
// QR codes live in data/qr-codes.json as: [{ "qr": "..." }, ...]
// or data/qr-codes.csv with a header column named "qr".
const qrCodes = new SharedArray('qr-codes', function () {
  const raw = open(CONFIG.qrDataFile);
  let list = [];

  if (CONFIG.qrDataFile.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    list = parsed.map((row) => (typeof row === 'string' ? row : row.qr || row.code || row.token));
  } else {
    // simple CSV: first line is header, find the "qr" column
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    let idx = header.indexOf('qr');
    if (idx === -1) idx = 0; // fall back to first column
    list = lines.slice(1).map((l) => l.split(',')[idx].trim());
  }

  if (!list.length) {
    fail(`No QR codes found in ${CONFIG.qrDataFile}. Add real codes before running.`);
  }
  return list;
});

/* ---- 2. Custom metrics -------------------------------------------------- */
const checkinSuccess = new Rate('checkin_success');         // % of valid check-ins
const checkinDuration = new Trend('checkin_duration', true); // server response time
const duplicateScans = new Counter('duplicate_scans');       // backend rejected as already-used
const serverErrors = new Counter('server_errors');           // 5xx / network failures

/* ---- 3. Test profile (burst by default) -------------------------------- */
export const options = {
  scenarios: CONFIG.scenarios,
  thresholds: {
    // Tune these to ShareRing's SLA. Test FAILS if any are breached.
    http_req_failed: ['rate<0.01'],            // < 1% requests fail
    checkin_success: ['rate>0.99'],            // > 99% check-ins succeed
    http_req_duration: ['p(95)<800', 'p(99)<2000'], // p95 < 0.8s, p99 < 2s
    checkin_duration: ['p(95)<800'],
  },
};

/* ---- 4. The check-in request ------------------------------------------- */
export default function () {
  // Give every iteration a unique QR (no two attendees share a code).
  // iterationInTest is a global, monotonically increasing index.
  const i = exec.scenario.iterationInTest % qrCodes.length;
  const qr = qrCodes[i];

  const payload = JSON.stringify(
    CONFIG.buildBody ? CONFIG.buildBody(qr) : { qr: qr }
  );

  const params = {
    headers: CONFIG.headers,
    tags: { name: 'qr_checkin' },
    timeout: CONFIG.requestTimeout,
  };

  const res = http.post(`${CONFIG.baseUrl}${CONFIG.checkinPath}`, payload, params);

  checkinDuration.add(res.timings.duration);

  // Classify the outcome.
  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  if (res.status >= 500 || res.status === 0) {
    serverErrors.add(1);
    checkinSuccess.add(false);
  } else if (CONFIG.isDuplicate && CONFIG.isDuplicate(res)) {
    // e.g. backend returns 409 / "already checked in" — not a failure of load,
    // but worth tracking so race conditions show up.
    duplicateScans.add(1);
    checkinSuccess.add(true);
  } else {
    checkinSuccess.add(ok);
  }
}

/* ---- 5. End-of-test summary (printed to console) ----------------------- */
export function handleSummary(data) {
  return {
    stdout: textSummary(data),
    'summary.json': JSON.stringify(data, null, 2),
  };
}

// minimal text summary (avoids extra deps)
function textSummary(data) {
  const m = data.metrics;
  const g = (name, field, suffix = '') => {
    const v = m[name] && m[name].values && m[name].values[field];
    return v === undefined ? 'n/a' : `${Math.round(v * 100) / 100}${suffix}`;
  };
  return `
═══════════════════════════════════════════════
  SBAC Entrance — QR Check-in Load Test Results
═══════════════════════════════════════════════
  Total requests      : ${g('http_reqs', 'count')}
  Throughput (req/s)  : ${g('http_reqs', 'rate', '/s')}
  Failed requests     : ${g('http_req_failed', 'rate')} (rate)
  Check-in success    : ${g('checkin_success', 'rate')} (rate)
  Duplicate scans     : ${g('duplicate_scans', 'count')}
  Server errors (5xx) : ${g('server_errors', 'count')}
  ---------------------------------------------
  Response time (ms)
    avg : ${g('http_req_duration', 'avg')}
    p90 : ${g('http_req_duration', 'p(90)')}
    p95 : ${g('http_req_duration', 'p(95)')}
    p99 : ${g('http_req_duration', 'p(99)')}
    max : ${g('http_req_duration', 'max')}
═══════════════════════════════════════════════
`;
}
