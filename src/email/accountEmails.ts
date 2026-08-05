// FEATURE-041: templates mínimos (sin diseño/branding elaborado, fuera de alcance) para los 3
// emails transaccionales de la Feature. Todas las URLs se arman con ORCHESTRATOR_WEB_ORIGIN
// (mismo origen ya usado para CORS/cookies -- src/server/app.ts) para no depender de otra config.
import type { EmailClient } from "./resendClient.js";

function baseUrl(): string {
  const origin = process.env.ORCHESTRATOR_WEB_ORIGIN;
  if (!origin) throw new Error("ORCHESTRATOR_WEB_ORIGIN requerido para construir enlaces de email.");
  return origin;
}

function wrapHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family: sans-serif; color: #18181b;">` +
    `<h2>${title}</h2>${bodyHtml}` +
    `<p style="color:#71717a; font-size: 12px;">Si no esperabas este email, podés ignorarlo.</p>` +
    `</body></html>`;
}

export async function sendVerificationEmail(client: EmailClient, params: { to: string; rawToken: string }): Promise<void> {
  const url = `${baseUrl()}/verify-email?token=${encodeURIComponent(params.rawToken)}`;
  await client.send({
    to: params.to,
    subject: "Confirmá tu email",
    text: `Confirmá tu cuenta entrando a: ${url}`,
    html: wrapHtml("Confirmá tu email", `<p>Hacé click para activar tu cuenta:</p><p><a href="${url}">${url}</a></p>`),
  });
}

export async function sendPasswordResetEmail(client: EmailClient, params: { to: string; rawToken: string }): Promise<void> {
  const url = `${baseUrl()}/reset-password?token=${encodeURIComponent(params.rawToken)}`;
  await client.send({
    to: params.to,
    subject: "Recuperar tu contraseña",
    text: `Restablecé tu contraseña entrando a: ${url}`,
    html: wrapHtml("Recuperar tu contraseña", `<p>Hacé click para elegir una nueva contraseña:</p><p><a href="${url}">${url}</a></p>`),
  });
}

export async function sendAccountActivationEmail(client: EmailClient, params: { to: string; rawToken: string }): Promise<void> {
  const url = `${baseUrl()}/activate-account?token=${encodeURIComponent(params.rawToken)}`;
  await client.send({
    to: params.to,
    subject: "Activá tu cuenta",
    text: `Un administrador creó una cuenta para vos. Activala y elegí tu contraseña en: ${url}`,
    html: wrapHtml(
      "Activá tu cuenta",
      `<p>Un administrador creó una cuenta para vos. Activala y elegí tu contraseña:</p><p><a href="${url}">${url}</a></p>`
    ),
  });
}
