import { createServer, type ServerResponse } from "node:http";
import { ZodError, type ZodType } from "zod";
import { InfraiError } from "./infrai.js";
import {
  createSignedDelivery,
  deadlineFollowUpBody,
  followUpDeadline,
  intakeMatter,
  matterIntakeBody,
  offboardBody,
  offboardTenant,
  signedDeliveryBody,
} from "./matter_workflows.js";

const routes = new Map<string, { schema: ZodType; run: (value: never) => Promise<unknown> }>([
  ["POST /tenants/intake", { schema: matterIntakeBody, run: intakeMatter }],
  ["POST /documents/signed-delivery", { schema: signedDeliveryBody, run: createSignedDelivery }],
  ["POST /deadlines/follow-up", { schema: deadlineFollowUpBody, run: followUpDeadline }],
  ["POST /tenants/offboard", { schema: offboardBody, run: offboardTenant }],
]);

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  const route = routes.get(`${request.method} ${request.url}`);
  if (!route) return send(response, 404, { error: "route_not_found" });

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = route.schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    send(response, 200, await route.run(input as never));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return send(response, 400, { error: "invalid_request" });
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.code, message: error.message });
    }
    send(response, 502, { error: "upstream_request_failed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Legal intake service listening on http://localhost:${port}`));
