import http from 'k6/http';
import { check } from 'k6';
import { CONFIG } from './config.js';

/* ────────────────────────────────────────────────────────────────────────
 * Smoke test — ONE request, ONE virtual user.
 * Run this FIRST to confirm the endpoint, headers, and body shape are right
 * BEFORE firing the full burst. Use a real (test) QR you don't mind consuming.
 *
 *   k6 run -e QR=SBAC-DEMO-0001 smoke-test.js
 * ──────────────────────────────────────────────────────────────────────── */

export const options = { vus: 1, iterations: 1 };

export default function () {
  const qr = __ENV.QR || 'SBAC-DEMO-0001';
  const payload = JSON.stringify(CONFIG.buildBody(qr));

  const res = http.post(`${CONFIG.baseUrl}${CONFIG.checkinPath}`, payload, {
    headers: CONFIG.headers,
    timeout: CONFIG.requestTimeout,
  });

  console.log(`→ POST ${CONFIG.baseUrl}${CONFIG.checkinPath}`);
  console.log(`→ body: ${payload}`);
  console.log(`← status: ${res.status}`);
  console.log(`← body:   ${res.body}`);
  console.log(`← time:   ${Math.round(res.timings.duration)} ms`);

  check(res, { 'got a response (not 0/timeout)': (r) => r.status !== 0 });
}
