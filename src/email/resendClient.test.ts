import assert from "node:assert/strict";
import test from "node:test";
import { createResendEmailClient, EmailDeliveryError } from "./resendClient.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("createResendEmailClient manda el remitente, destinatario y auth correctos", async () => {
  let capturedInit: RequestInit | undefined;
  const client = createResendEmailClient("re_test", "no-reply@mail.asdru.space", async (_url, init) => {
    capturedInit = init;
    return jsonResponse(200, { id: "email-id" });
  });
  await client.send({ to: "user@example.com", subject: "Asunto", html: "<p>hola</p>", text: "hola" });

  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.from, "no-reply@mail.asdru.space");
  assert.deepEqual(body.to, ["user@example.com"]);
  assert.equal((capturedInit?.headers as Record<string, string>).authorization, "Bearer re_test");
});

test("createResendEmailClient lanza EmailDeliveryError sin filtrar el cuerpo crudo de Resend", async () => {
  const client = createResendEmailClient("re_test", "no-reply@mail.asdru.space", async () =>
    jsonResponse(422, { message: "detalle interno de Resend" })
  );
  await assert.rejects(
    client.send({ to: "user@example.com", subject: "x", html: "x", text: "x" }),
    (err: unknown) => {
      assert.ok(err instanceof EmailDeliveryError);
      assert.doesNotMatch(err.message, /detalle interno de Resend/);
      return true;
    }
  );
});
