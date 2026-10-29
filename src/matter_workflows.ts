import { z } from "zod";
import { infrai } from "./infrai.js";

const tenantId = z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/);

export const matterIntakeBody = z.object({
  tenant_id: tenantId,
  matter_id: z.string().min(1).max(80),
  idempotency_key: z.string().uuid(),
});

export const signedDeliveryBody = z.object({
  tenant_id: tenantId,
  matter_id: z.string().min(1).max(80),
  document_id: z.string().min(1).max(80),
});

export const deadlineFollowUpBody = signedDeliveryBody.extend({
  deadline_at: z.string().datetime({ offset: true }),
});

export const offboardBody = z.object({
  tenant_id: tenantId,
  credential_id: z.string().min(1),
});

export function bucketFor(tenant: string): string {
  return `legal-${tenant}`;
}

function signedKey(matterId: string, documentId: string): string {
  return `matters/${encodeURIComponent(matterId)}/signed/${encodeURIComponent(documentId)}.pdf`;
}

export async function intakeMatter(input: z.infer<typeof matterIntakeBody>) {
  const bucket = bucketFor(input.tenant_id);
  await infrai.storage.bucket.create({ name: bucket });
  const credential = await infrai.account.keys.create({
    name: `tenant-${input.tenant_id}`,
    idempotency_key: input.idempotency_key,
  });

  return {
    matter_id: input.matter_id,
    bucket,
    credential_id: credential.id,
    credential: credential.key,
    credential_notice: "Store this value now; the plaintext credential is shown only once.",
  };
}

export async function createSignedDelivery(input: z.infer<typeof signedDeliveryBody>) {
  const bucket = bucketFor(input.tenant_id);
  const key = signedKey(input.matter_id, input.document_id);
  const object = await infrai.storage.object.head(bucket, key);
  if (!object.found) {
    return { ready: false as const, matter_id: input.matter_id, document_id: input.document_id };
  }
  const signed = await infrai.storage.object.presign(bucket, key, {
    op: "get",
    expires_seconds: 900,
    response_disposition: `attachment; filename="${input.document_id}.pdf"`,
    idempotency_key: `delivery:${input.tenant_id}:${input.matter_id}:${input.document_id}`,
  });
  return { ready: true as const, download_url: signed.url, expires_seconds: 900 };
}

export function decideDeadlineFollowUp(
  input: { deadline_at: string },
  signedDocumentFound: boolean,
  now: Date,
) {
  if (signedDocumentFound) return { action: "close_follow_up" as const };
  if (new Date(input.deadline_at).getTime() <= now.getTime()) {
    return { action: "escalate_overdue" as const };
  }
  return { action: "remind_signer" as const };
}

export async function followUpDeadline(input: z.infer<typeof deadlineFollowUpBody>, now = new Date()) {
  const found = await infrai.storage.object.head(
    bucketFor(input.tenant_id),
    signedKey(input.matter_id, input.document_id),
  );
  return decideDeadlineFollowUp({ deadline_at: input.deadline_at }, found.found, now);
}

export async function offboardTenant(input: z.infer<typeof offboardBody>) {
  const outcomes = await Promise.allSettled([
    infrai.storage.bucket.delete(bucketFor(input.tenant_id)),
    infrai.account.keys.revoke(input.credential_id),
  ]);
  const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (rejected) throw rejected.reason;
  return { status: "offboarded" as const, tenant_id: input.tenant_id };
}
