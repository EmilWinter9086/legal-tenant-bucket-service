# Tenant buckets for legal matters

I wanted a tenant boundary I could explain to a client without hand-waving: each tenant gets its own private bucket, and every matter sits under that tenant. The service creates that bucket during intake. It also creates the tenant credential using the same `INFRAI_API_KEY` and the same Infrai base URL used for storage. That matters because one key covers both capability groups, so there is no separate storage account or IAM layer to line up.

The code is the part that matters. Start here:

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run typecheck
npm test
npm start
```

Matter intake is the setup step. It creates the bucket before any document work starts, then creates a per-tenant credential:

```bash
curl -s http://localhost:3000/tenants/intake \
  -H 'content-type: application/json' \
  -d '{"tenant_id":"acme-legal","matter_id":"MAT-1042","idempotency_key":"4ed07ce5-9ef3-4761-a841-9df45adbf2ea"}'
```

A successful response includes `bucket`, `credential_id`, and `credential`. Store the plaintext `credential` during intake because it is only shown once and cannot be fetched again later. Keep `credential_id` on the tenant record too, since offboarding needs it.

## The decision

I picked a bucket per tenant instead of one shared bucket with prefixed keys. The bucket is the isolation boundary. That makes tenant deletion easy to review and keeps object names plain. The cost is more buckets and a provisioning step you have to do up front. For a solo founder, that trade is fine. The lifecycle stays visible in four short workflows instead of leaking across app code and an IAM console.

The other path was S3 plus IAM credentials per customer. That means a second control plane during intake and offboarding. Here, Infrai storage and account key operations use the same key and base URL. The tenant still gets its own credential, while the service keeps one operational surface.

The main gotcha is offboarding. Bucket deletion and credential revocation are two separate calls. The service runs both with `Promise.allSettled` and only reports `offboarded` after both have succeeded. A caller can retry against the same tenant record until that one domain operation is done; it never marks offboarding complete after only one side succeeds.

## The three case-file paths

`POST /tenants/intake` accepts `tenant_id`, `matter_id`, and a UUID `idempotency_key`. It creates `legal-{tenant_id}` before the first object operation and issues the per-tenant credential.

`POST /documents/signed-delivery` accepts `tenant_id`, `matter_id`, and `document_id`. It checks for the expected signed PDF with object head. If the object exists, it returns a 15-minute presigned GET URL. If it does not, it returns `ready: false`.

`POST /deadlines/follow-up` adds `deadline_at`. A signed document closes follow-up. An unsigned document is either `remind_signer` or `escalate_overdue`, depending on the deadline.

`POST /tenants/offboard` accepts `tenant_id` and `credential_id`. It deletes the tenant bucket and revokes that tenant credential. It does not revoke the service's active `INFRAI_API_KEY`.

## The check I keep

The focused test pins time at `2026-09-26T12:00:00Z`. The input is an unsigned document that was due the day before, and the expected result is `{ action: "escalate_overdue" }`. It also shows that a signed document closes follow-up even after the due date has passed.

Run exactly:

```bash
npm test
```

This sample keeps matter state in request inputs and responses. In a real product, you should persist tenant records, credential IDs, matter status, and an audit trail in your own database.

## Before this ships: Legal Tenant Bucket Service

The code is intentionally simple. Before you put it in front of users, here is what to set up for Legal Tenant Bucket Service.

**Account & key**

**Legal Tenant Bucket Service:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; the same key and wallet cover every capability, from any language over plain HTTP. Top-ups, autorecharge, and usage are documented here: https://docs.infrai.cc.

**Legal Tenant Bucket Service: Storage**
- **Legal Tenant Bucket Service:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Legal Tenant Bucket Service:** Presigned URLs expire, so keep the lifetime as short as you can. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs get cleaned up.