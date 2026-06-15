# SBAC Entrance — QR Check-in Load Test

Load test for the event entrance flow: ~700 attendees scan a QR code to check in.
The default profile is a **burst** — everyone scans at gate-open — ramping to
**400 req/s** and holding. Built with [k6](https://k6.io) (free, open source).

> ⚠️ **Only run this against a system you are authorised to test** (your own
> staging environment, or ShareRing's backend with written permission). Firing
> hundreds of requests per second at someone else's production system without
> consent can violate their terms of service or the law.

---

## 1. Install k6 (free)

| OS | Command |
|----|---------|
| macOS | `brew install k6` |
| Windows | `choco install k6` or `winget install k6` |
| Linux (Debian/Ubuntu) | see https://grafana.com/docs/k6/latest/set-up/install-k6/ |

Check it: `k6 version`

## 2. Add your QR codes

Put the real check-in QR payloads in `data/qr-codes.json` (one per attendee):

```json
[
  { "qr": "ACTUAL-CODE-1" },
  { "qr": "ACTUAL-CODE-2" }
]
```

A CSV with a `qr` header column also works (`data/qr-codes.csv`).
Sample files are provided as `*.sample.json` / `*.sample.csv` — copy one:

```bash
cp data/qr-codes.sample.json data/qr-codes.json
```

> Real codes are git-ignored so they never get committed.

## 3. Point it at the API

Edit **`config.js`** — these three things must match ShareRing's real API:

1. `BASE_URL` + `CHECKIN_PATH` — the check-in endpoint.
2. `buildBody(qr)` — the JSON body the endpoint expects.
3. `isDuplicate(res)` — how the API signals an already-used QR (so race
   conditions show up in the report instead of looking like failures).

Anything in `config.js` can also be set on the command line, e.g.
`-e BASE_URL=... -e AUTH_TOKEN=...`.

## 4. Smoke test first (always)

Send a single request to confirm the shape is right before the burst:

```bash
k6 run -e QR=SBAC-DEMO-0001 smoke-test.js
```

It prints the exact request and the server's response. Fix `config.js` until
you get a clean 2xx, then move on.

## 5. Run the load test

```bash
# default: burst to 400 req/s
k6 run qr-checkin-load-test.js

# override anything
k6 run -e BASE_URL=https://staging.sharering.network \
       -e CHECKIN_PATH=/v1/checkin \
       -e AUTH_TOKEN=xxxxx \
       -e TARGET_RPS=400 \
       qr-checkin-load-test.js
```

### Scenarios (`-e SCENARIO=...`)

| Scenario | What it does | When to use |
|----------|--------------|-------------|
| `burst` (default) | Ramps to `TARGET_RPS` in `RAMP_SECONDS`, holds, drops | Realistic gate-open crowd |
| `sustained` | Holds `TARGET_RPS` for 60s | Check steady throughput |
| `stress` | Pushes to 1×→2×→3× `TARGET_RPS` | Find the breaking point |

### Useful knobs

| Env var | Default | Meaning |
|---------|---------|---------|
| `TARGET_RPS` | `400` | Peak requests per second |
| `RAMP_SECONDS` | `5` | Seconds to reach peak (smaller = sharper burst) |
| `HOLD_SECONDS` | `5` | Seconds held at peak |
| `MAX_VUS` | `600` | Ceiling on concurrent virtual users |
| `QR_DATA_FILE` | `./data/qr-codes.json` | Path to your QR data |

## 6. Read the results

At the end k6 prints a summary and writes `summary.json`. Watch:

- **Throughput (req/s)** — did it actually hit your target rate?
- **http_req_failed** — should be < 1%. Anything higher = the backend is dropping requests.
- **p95 / p99 response time** — tail latency under load. If p99 balloons, that's
  the point where attendees would see a spinner at the gate.
- **server_errors** — count of 5xx / timeouts (hard failures).
- **duplicate_scans** — if this is non-zero unexpectedly, the backend may have a
  race condition handling simultaneous scans.

The run **exits non-zero if any threshold in `qr-checkin-load-test.js` is breached** —
handy for CI. Thresholds are set to: <1% failures, >99% check-in success,
p95 < 800ms, p99 < 2s. Adjust to ShareRing's SLA.

## 7. Test from outside your network (optional, free tier)

Running from your laptop tests the server but includes your local network/ISP.
To test from the cloud, k6 scripts run as-is on **Grafana Cloud k6** (free tier
has a monthly test quota):

```bash
k6 cloud qr-checkin-load-test.js
```

---

### Files

```
qr-checkin-load-test.js   # main burst test
smoke-test.js             # single-request sanity check — run this first
config.js                 # endpoint, body shape, load profile (EDIT THIS)
data/qr-codes.sample.json # template — copy to qr-codes.json and fill in
data/qr-codes.sample.csv  # CSV alternative
```
