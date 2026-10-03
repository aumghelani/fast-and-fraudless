# Fast and Fraudless: drop-in for your bank

Fast and Fraudless runs on one on-prem box and talks to the bank's existing systems in their own formats:
ISO 20022 payment messages in, core-banking batches in, signed webhooks, SAR drafts and CSV out. Nothing goes to
a cloud. Outbound traffic goes only to internal URLs that the bank configures.

All of this lives in `backend/integrations.py` under `/api/integrations`. It reuses the same ring map and rules
as the call guard, so a payment message and a phone call get the same decision for the same payee.

| Need | How | Status |
|---|---|---|
| Screen a wire before release | `POST /api/integrations/iso20022/pacs008` (FI-to-FI credit transfer) | built |
| Screen an online/corporate payment | `POST /api/integrations/iso20022/pain001` (credit transfer initiation) | built |
| Feed transactions from core banking | `POST /api/integrations/transactions` (CSV or JSON batch) | built (stored, see note) |
| Open cases in case management / AML | HMAC-signed webhooks | built |
| Hand a SAR to the BSA filing team | FinCEN SAR-style XML / JSON **draft** | built |
| Case reporting | CSV export | built |
| Alert staff phones | content-free Telegram (+ Slack) alerts (`backend/notifier.py`) | built; Teams: roadmap |
| Message bus (Kafka, IBM MQ) | listener feeding the same parser | roadmap |
| SSO / LDAP | bank identity provider | roadmap; today an optional API token |
| Look like an in-house tool | `config/branding.json` | API built; UI header wiring is a follow-up |

## Architecture sketch

```
  Bank systems (bank network)                        Dell Pro Max GB10 (on-prem, air-gap capable)
 ┌───────────────────────────┐                     ┌───────────────────────────────────────────────────────┐
 │ Payment hub / wire room   │── pacs.008 ────────▶│ backend :8790  /api/integrations                      │
 │                           │◀─ RING_MATCH/CLEAR ─│   parse ISO 20022 → calls.payee_check → rules.decide   │
 ├───────────────────────────┤                     │   (payee_check reads the GPU ring map, Mongo `rings`)  │
 │ Online / corporate banking│── pain.001 ────────▶│                                                       │
 ├───────────────────────────┤                     │ Mongo 8.2: inbound_payments, inbound_transactions,    │
 │ Core banking batch        │── CSV / JSON ──────▶│   webhook_deliveries, decisions (audit trail)         │
 ├───────────────────────────┤                     │                                                       │
 │ Case management / AML     │◀─ signed webhooks ──│ change stream on calls, sar_drafts, rings             │
 │                           │── GET SAR XML/JSON ▶│                                                       │
 │                           │── GET cases CSV ───▶│ ring finder (RAPIDS GPU) · Nemotron (vLLM) · Parakeet │
 ├───────────────────────────┤                     │ investigator agent in an OpenShell sandbox            │
 │ Analyst / banker browser  │◀─ Control Room ─────│   (it can reach /api/agent/** only, not this API)     │
 └───────────────────────────┘                     └───────────────────────────────────────────────────────┘
   Staff phones ◀── content-free alerts only (no names, no amounts): Telegram, Slack
```

## Deploy

- **Hardware:** one Dell Pro Max GB10 (DGX OS, aarch64, 128 GB unified memory) inside the bank.
- **Containers:** `mongo:8.2` (replica set `rs0`), vLLM serving Nemotron-3-Nano NVFP4, the Parakeet ASR service,
  RAPIDS for the ring finder (see `ARCHITECTURE.md` section 3). The backend runs in a host venv on `:8790`
  (`scripts/backend_setup.sh` installs from offline wheels, `scripts/backend_run.sh` starts it).
- **Air-gap capable:** models, Python wheels and UI fonts are on the box. No CDN, no cloud API, no telemetry.
  The demo runs with Wi-Fi off. The only possible outbound traffic is (a) content-free alerts and (b) webhooks
  to the internal URLs you configure.
- **Settings:** `backend_run.sh` loads every `~/tw/secrets/*.env`. Put the integration variables in
  `~/tw/secrets/integrations.env` and restart the backend. Webhook settings are read at startup. Branding is
  read on every request.

| Variable | Meaning | Default |
|---|---|---|
| `TW_WEBHOOKS` | comma-separated webhook URLs (all events). Replaces the list in the file | unset (webhooks off) |
| `TW_WEBHOOK_SECRET` | HMAC key for `X-FastFraudless-Signature`. **Without it nothing is sent** | unset |
| `TW_INTEGRATIONS_FILE` | webhook config file (see `config/integrations.example.json`) | `config/integrations.json` |
| `TW_WEBHOOKS_ALLOW_PUBLIC` | `1` allows public IP destinations (for banks that use their own public ranges internally) | off |
| `TW_PUBLIC_BASE_URL` | prefix for the `links` in webhook bodies, e.g. `http://fraud-box.bank.internal:8790` | relative links |
| `TW_INTEGRATIONS_TOKEN` | if set, integration endpoints need `Authorization: Bearer <token>` or `X-API-Key` | open |
| `TW_BRANDING_FILE` | white-label file | `config/branding.json` |
| `TW_DATA_LABEL` | label printed on SAR drafts | `SYNTHETIC (IBM AML replay)` |

## Inbound

### ISO 20022 payment screening

`POST /api/integrations/iso20022/pacs008` and `POST /api/integrations/iso20022/pain001`, body = the XML message
(`Content-Type: application/xml`, UTF-8, up to 1 MB and 100 transactions).

- **Any version, any namespace.** Elements are matched by local name. Tested with pacs.008.001.08,
  pain.001.001.03 and .09, and messages without a namespace. A business envelope (AppHdr + Document) is fine.
- **Accounts:** `IBAN` (normalised, ISO 13616 check digits tested; a failed check is a warning) or `Othr/Id`
  (with `SchmeNm` if present). Agents: BICFI/BIC, clearing member id, LEI or name.
- **Read:** MsgId, EndToEndId, InstrId, UETR, amount and currency, debtor and creditor names and accounts,
  remittance info (unstructured and structured references), settlement or requested date. `NbOfTxs` and
  `CtrlSum` mismatches come back as warnings.
- **Decision:** each creditor account goes through `calls.payee_check` (the GPU ring map, the same check the call
  guard uses), then `rules.decide`. Code decides: a payee inside a ring found by the GPU worker means HOLD. This
  path has no call cues and no customer profile, so only the ring rule can fire here.
- **Response:** `message_id`, `kind`, `version`, `screening` (`RING_MATCH` | `CLEAR` | `UNAVAILABLE`), `ring_id`,
  `hops` (1 = the payee is the ring's hub, 2 = another account of the ring, one step from the hub), `hold_recommended`, `recommendation`
  (`HOLD` | `NO_HOLD`), `reasons`, `questions` (for the banker's call-back), `transactions[]` (one result per
  transaction; the message takes the worst), `warnings`, `duplicate`, `persisted`, `sha256`.
- **Status codes:** 200; 400 malformed or invalid message; 409 MsgId already received with different content;
  413 too large; 422 wrong message type for the endpoint; 503 `UNAVAILABLE` (ring map unreachable: never
  reported as `CLEAR`).
- **Idempotent:** the same MsgId with the same bytes returns the stored result with `"duplicate": true`.
- **Safe parsing:** DTDs and entity declarations are rejected (no XXE, no entity expansion).
- **Stored:** Mongo `inbound_payments` keeps the raw XML, its SHA-256, the parsed message and the result.
  The SSE bus gets an `integration` event. A HOLD also sends a `hold_recommended` webhook (`source: iso20022`).

### Core-banking batch

`POST /api/integrations/transactions` takes either

- **CSV in the IBM AML column layout** (header optional, 10 or 11 columns):
  `Timestamp, From Bank, Account, To Bank, Account, Amount Received, Receiving Currency, Amount Paid,
  Payment Currency, Payment Format[, Is Laundering]`, or
- **JSON:** a list (or `{"transactions": [...]}`) of objects with `ts`, `src`, `dst`, `amount`, `currency` and
  optional `from_bank`, `to_bank`, `amount_rec`, `cur_rec`, `format`, `is_laundering`, `ref` (your
  transaction reference).

Every row is validated (timestamp `YYYY/MM/DD HH:MM` or ISO 8601, account ids, amounts). Good rows are stored,
bad rows are reported with their row number (first 25). Ids are deterministic (`ref`, or a hash of the row),
so re-sending a batch does not create duplicates. `?dry_run=true` validates without storing. Limits: 25 MB
and 50,000 rows per request. The response gives `received`, `accepted`, `inserted`, `duplicates`, `rejected`,
`errors`, `batch_id`.

**Honest note:** rows land in Mongo `inbound_transactions`. In this demo the GPU ring finder replays the IBM AML
HI-Medium CSV (31.9M synthetic, labelled transactions) on a simulated clock. Pointing the ring finder at
`inbound_transactions` is the next step and is not wired today.

### Roadmap: message bus

A Kafka or IBM MQ listener that hands each message to the same `parse_iso20022` and `screen_message`
functions. Not built.

## Outbound

### Signed webhooks

Events:

| Event | When | `data` |
|---|---|---|
| `hold_recommended` | a call reaches HOLD (`calls`), or an ISO 20022 message is a ring match | call_id or message_id, ring_id, hops, cue names, banker_decision |
| `ring_escalated` | the GPU ring finder escalates a ring (`rings`, tier `escalate`) | ring_id, type, n_accounts, n_txns, found_at |
| `sar_drafted` | the agent's SAR draft is stored and validated (`sar_drafts`) | sar_id, ring_id, revision, citations_verified, citations_total, valid_all |
| `sar_decided` | an analyst approves or rejects the draft | the same, plus decision, decided_by, decided_at |

Body (compact JSON; sign the exact bytes you receive):

```json
{"bank":"Your Bank","data":{"ring_id":"R-102","sar_id":"SAR-R-102","revision":1,"citations_total":13,
 "citations_verified":13,"valid_all":true},"event":"sar_drafted","event_id":"5f1c...","links":{
 "ring":"http://fraud-box.bank.internal:8790/api/rings/R-102",
 "sar_json":"http://fraud-box.bank.internal:8790/api/integrations/sar/SAR-R-102.json",
 "sar_xml":"http://fraud-box.bank.internal:8790/api/integrations/sar/SAR-R-102/fincen.xml"},
 "source":"fast-and-fraudless","ts":"2026-10-03T17:14:51+00:00"}
```

Headers: `X-FastFraudless-Signature: sha256=<hex HMAC-SHA256 of the body with TW_WEBHOOK_SECRET>`,
`X-FastFraudless-Event`, `X-FastFraudless-Delivery` (delivery id), `Content-Type: application/json`.

Verify on the receiving side:

```python
import hashlib, hmac

def verify(body: bytes, header: str, secret: str) -> bool:
    want = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, header or "")
```

- **Content-light by design:** ids, status and links only. No customer names, transcripts or amounts. The
  receiver pulls detail from the links over the bank network.
- **Delivery:** at least once. Deduplicate on `event_id`. Retries after 1, 2, 4 ... 60 s (up to 8 attempts) on
  network errors, 5xx, 408, 425 and 429. Any other 4xx fails at once. Every attempt is logged in Mongo
  `webhook_deliveries` (status, attempts, last 20 attempts, exact body). Pending deliveries resume after a
  restart, and the change-stream resume token (`watch_state.integrations_webhooks`) means no event is lost while
  the backend is down. Events start when webhooks are switched on (no backfill).
- **Guards:** no secret, no sending. Destinations must resolve to private, loopback or link-local addresses
  unless `TW_WEBHOOKS_ALLOW_PUBLIC=1`. Environment proxies are ignored and redirects are not followed.
- **Off by default:** with no URLs configured, the backend logs one line and does nothing.

### SAR draft for the BSA filing team

`GET /api/integrations/sar/{sar_id}/fincen.xml` and `GET /api/integrations/sar/{sar_id}.json` (same content).

- Marked **DRAFT, NOT FILED** in the root attributes, an XML comment and a disclaimer that quotes the SAR
  confidentiality rule. Fast and Fraudless never files anything; the bank's BSA e-filing process takes it from
  here.
- Sections follow the FinCEN SAR form: Part I subjects (account ids, hub or counterparty), Part II activity
  (date range, total in USD, pattern, a *suggested* category, transactions), Part IV filing institution (the
  bank name from branding), Part V the narrative. It is SAR-style, **not** the FinCEN BSA e-filing XML schema.
- **Only validated citations:** the transactions, subjects, amounts and dates come only from citations the SAR
  validator verified against Mongo. Unverified citations are counted in `CitationValidation`, never listed.
  The narrative is the draft text as written and stays for the analyst to edit.
- Also included: ring context from the GPU ring finder, the analyst decision, the data label (SYNTHETIC here).
- Every export is written to the `decisions` audit trail and sent with `Cache-Control: no-store`.

### Case export

`GET /api/integrations/cases/export.csv` gives one row per case with these columns: ring_id, ring_type, tier,
case_status, total_usd, n_transactions, n_accounts, hub, accounts, sar_id, sar_status, sar_valid_all,
citations_verified, citations_total, analyst_decision, decided_at, ring_found_at, case_first_event_at,
case_last_event_at, sar_received_at. `?scope=escalated` adds escalated rings that have no case yet. Cells that
start with `= + - @` get a leading `'` so a spreadsheet does not run them as formulas.

### Alerts

The existing notifier sends content-free texts (`Ring R-102 escalated — SAR draft ready for analyst review`,
`Call 0412: HOLD advised`) to Telegram and, if configured, Slack. A sanitizer strips names, amounts,
account numbers and transaction ids before anything is sent. Microsoft Teams would get the same text (roadmap).

## Identity

- **Today:** the Control Room runs on the box's own monitor. Integration endpoints accept an optional token
  (`TW_INTEGRATIONS_TOKEN`). `/branding` and `/health` stay open so the UI can read them.
- **Roadmap:** SSO (SAML or OIDC through the bank's identity provider) and LDAP or Active Directory groups for the
  banker and analyst roles. The audit trail records the role today (banker, analyst, agent). With SSO it would
  record the person.

## White-label

`config/branding.json` (or `TW_BRANDING_FILE`): `bank_name` (default "Your Bank"), `product_name` ("Fast and
Fraudless"), `primary_color`, `accent_color` (`#RGB` or `#RRGGBB`, a bad value falls back with a warning),
`logo_path` (png, svg, jpg or webp; relative to the file), `timezone`. Extra flat keys (for example
`support_phone`) are passed through. `GET /api/integrations/branding` returns the merged settings plus `logo_url`.
`GET /api/integrations/branding/logo` serves the logo with a locked-down Content-Security-Policy. The bank name
also appears in webhook bodies and SAR drafts. The Control Room UI does not read this yet; wiring its header is
a small follow-up.

## Audit trail

| Collection | What |
|---|---|
| `decisions` | who did what and when: banker hold/release, analyst SAR approve/reject, agent SAR drafted, SAR draft exported |
| `inbound_payments` | every ISO 20022 message: raw XML, SHA-256, parsed fields, screening result |
| `inbound_transactions` | every batch row with its `batch_id` and row number |
| `webhook_deliveries` | every outbound attempt: destination (no credentials), status, response, timing |
| `egress_events` | the OpenShell sandbox egress log (ALLOWED / DENIED) |

## Data residency

All data stays in MongoDB on the box. All models run on the box. The investigator agent runs in an OpenShell
sandbox that can reach only `/api/agent/**` on the host. It cannot reach this integration API or the SAR exports.
Outbound traffic: content-free alerts and webhooks to the bank-internal URLs you configure. Nothing else.

## API reference

Interactive OpenAPI docs: `http://<box>:8790/docs`. The machine-readable spec is at `/openapi.json`, with the tag
`integrations`.

| Method | Path | |
|---|---|---|
| POST | `/api/integrations/iso20022/pacs008` | screen a pacs.008 message |
| POST | `/api/integrations/iso20022/pain001` | screen a pain.001 message |
| POST | `/api/integrations/transactions` | core-banking batch (CSV or JSON), `?dry_run=true` |
| GET | `/api/integrations/sar/{sar_id}/fincen.xml` | SAR draft, FinCEN-style XML |
| GET | `/api/integrations/sar/{sar_id}.json` | SAR draft, JSON |
| GET | `/api/integrations/cases/export.csv` | case export, `?scope=escalated` |
| GET | `/api/integrations/branding` | white-label settings |
| GET | `/api/integrations/branding/logo` | logo file |
| GET | `/api/integrations/health` | webhooks (configured, signed, last delivery, queue), counts |

New SSE event on `/api/events`: `{"type": "integration", "data": {"kind": "pacs.008" | "pain.001" |
"transactions", "ref": <MsgId or batch_id>, "result": {...}}}`. The UI ignores types it does not know. Add
it to the README contract when the UI starts using it.

## Try it

The samples are SYNTHETIC. Margaret's wire goes to `802225A40`, a labelled feeder account of a laundering ring in
the IBM AML replay. David's rent goes to a landlord account that is in no ring.

```bash
BOX=http://172.20.65.119:8790

# Margaret's $40,000 wire: RING_MATCH, hops 2 (the payee feeds the ring's hub), HOLD
curl -s -X POST $BOX/api/integrations/iso20022/pacs008 \
  -H 'Content-Type: application/xml' --data-binary @samples/pacs008_margaret.xml
# {"screening":"RING_MATCH","ring_id":"R-...","hops":2,"hold_recommended":true,"recommendation":"HOLD",
#  "reasons":["Payee 802225A40 feeds ring R-... found by the GPU ring finder"],
#  "questions":["Who gave you this account number?", ...], ...}

# Rent: CLEAR
curl -s -X POST $BOX/api/integrations/iso20022/pacs008 \
  -H 'Content-Type: application/xml' --data-binary @samples/pacs008_rent.xml

# Supplier batch (pain.001): one IBAN payee is clear, the "new supplier" account is a ring match
curl -s -X POST $BOX/api/integrations/iso20022/pain001 \
  -H 'Content-Type: application/xml' --data-binary @samples/pain001_example.xml

# Core-banking batch from the IBM file layout (dry run first)
head -1001 HI-Small_Trans.csv > batch.csv
curl -s -X POST "$BOX/api/integrations/transactions?dry_run=true" -H 'Content-Type: text/csv' --data-binary @batch.csv
curl -s -X POST $BOX/api/integrations/transactions -H 'Content-Type: application/json' \
  -d '[{"ts":"2026-10-03T10:41:00","src":"TW-MARG-0001","dst":"802225A40","amount":40000,"currency":"US Dollar","format":"Wire","ref":"CORE-778899"}]'

# SAR draft for the BSA team (DRAFT, not filed) and the case export
curl -s $BOX/api/integrations/sar/SAR-R-102/fincen.xml
curl -s $BOX/api/integrations/sar/SAR-R-102.json
curl -s -OJ $BOX/api/integrations/cases/export.csv

# Branding and integration health
curl -s $BOX/api/integrations/branding
curl -s $BOX/api/integrations/health

# Webhooks: set the URL and secret, restart the backend, then watch the delivery log
#   ~/tw/secrets/integrations.env:  TW_WEBHOOKS=http://10.20.30.40:8443/aml/inbound
#                                    TW_WEBHOOK_SECRET=<random 32+ bytes>
```

Replace `SAR-R-102` with a SAR id the box has (`GET /api/state` lists them under `sars`). If
`TW_INTEGRATIONS_TOKEN` is set, add `-H "Authorization: Bearer $TOKEN"`.
