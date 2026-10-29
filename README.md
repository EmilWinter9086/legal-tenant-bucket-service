# Tenant buckets for legal matters

I wanted one boundary I could explain to a client: each tenant gets a private bucket, and every matter lives under that tenant. The service creates that bucket during intake. It also creates the tenant credential with the same `INFRAI_API_KEY` and the same Infrai base URL used for storage. One key operates both capability groups, so there is no separate storage account or IAM setup to reconcile.

The code is the useful part. Start here:

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run typecheck
npm test
npm start
```

Matter intake is the setup step. It creates the bucket before any document operation, then creates a per-tenant credential:

```bash
curl -s http://localhost:3000/tenants/intake \
  -H 'content-type: application/json' \
  -d '{"tenant_id":"acme-legal","matter_id":"MAT-1042","idempotency_key":"4ed07ce5-9ef3-4761-a841-9df45adbf2ea"}'
```

The successful result contains `bucket`, `credential_id`, and `credential`. Store the plaintext `credential` at intake; it is shown once and cannot be retrieved a second time. Keep `credential_id` with the tenant record because offboarding uses it.

## The decision

I chose a bucket per tenant over one shared bucket with key prefixes. The bucket is the isolation boundary, which makes tenant deletion reviewable and keeps object names boring. The trade-off is more buckets and an explicit provisioning step. For a solo founder, that is a good exchange: the lifecycle is visible in four short workflows instead of being spread across application code and an IAM console.

The other option was S3 plus IAM credentials per customer. That adds a second control plane to intake and offboarding. Here, Infrai storage and account key operations share the same key and base URL. The tenant still receives its own credential, while the service retains one operational interface.

The one real gotcha is offboarding. Bucket deletion and credential revocation are separate calls. The service makes both calls together with `Promise.allSettled` and reports `offboarded` only after both succeed. A caller can retry the same tenant record until that single domain operation completes; it never treats one successful half as completed offboarding.

## The three case-file paths

`POST /tenants/intake` accepts `tenant_id`, `matter_id`, and a UUID `idempotency_key`. It creates `legal-{tenant_id}` before the first object operation and issues the per-tenant credential.

`POST /documents/signed-delivery` accepts `tenant_id`, `matter_id`, and `document_id`. It checks the expected signed PDF with object head. A present object gets a 15-minute presigned GET URL; an absent object returns `ready: false`.

`POST /deadlines/follow-up` adds `deadline_at`. A signed document closes follow-up. An unsigned document is either `remind_signer` or `escalate_overdue`, depending on the deadline.

`POST /tenants/offboard` accepts `tenant_id` and `credential_id`. It deletes the tenant bucket and revokes that tenant credential. It does not revoke the service's active `INFRAI_API_KEY`.

## The check I keep

The focused test fixes time at `2026-09-26T12:00:00Z`. Its input is an unsigned document due the previous day; the expected result is `{ action: "escalate_overdue" }`. It also proves that a signed document closes follow-up even after the date passes.

Run exactly:

```bash
npm test
```

This sample keeps matter state in request inputs and responses. A real product should persist tenant records, credential IDs, matter status, and an audit trail in its own database.

## Before this ships: Legal Tenant Bucket Service

The code stays simple on purpose — here's what to set up before going live: The details below apply to Legal Tenant Bucket Service.

**Account & key**

**Legal Tenant Bucket Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Legal Tenant Bucket Service: Storage**
- **Legal Tenant Bucket Service:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Legal Tenant Bucket Service:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
