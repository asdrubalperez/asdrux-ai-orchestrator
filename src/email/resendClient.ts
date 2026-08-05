// FEATURE-041, Riesgo 2: primera dependencia de entrega de email de este repo. Resend elegido por
// el owner (2026-08-04); llamada HTTP directa (sin SDK) siguiendo el mismo criterio que
// openAiApiMappingAdapter.ts -- una sola integración no justifica instalar un SDK propio.
const RESEND_SEND_URL = "https://api.resend.com/emails";

export class EmailDeliveryError extends Error {}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailClient {
  send(params: SendEmailParams): Promise<void>;
}

/** FEATURE-026/025-Parte-3, mismo patrón: fetchImpl inyectable para tests, default fetch real. */
export function createResendEmailClient(
  apiKey: string,
  fromAddress: string,
  fetchImpl: typeof fetch = fetch
): EmailClient {
  return {
    async send(params: SendEmailParams): Promise<void> {
      const response = await fetchImpl(RESEND_SEND_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [params.to],
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        // Nunca el body crudo de Resend en el error propagado al cliente HTTP (Seguridad,
        // sección 7 del diseño) -- se loguea acá para diagnóstico, nunca se devuelve tal cual.
        console.error(`[email] Resend respondió ${response.status}: ${body}`);
        throw new EmailDeliveryError(`No se pudo enviar el email (status ${response.status}).`);
      }
    },
  };
}

/** Lee la configuración recién al enviar, no al importar el módulo -- no rompe tests/arranque que no envían email. */
export function defaultEmailClient(): EmailClient {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !fromAddress) {
    throw new Error("RESEND_API_KEY y EMAIL_FROM_ADDRESS son requeridos para enviar email.");
  }
  return createResendEmailClient(apiKey, fromAddress);
}
