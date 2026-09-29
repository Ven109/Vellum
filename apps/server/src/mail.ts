import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
  readonly configured: boolean;
}

/**
 * SMTP when VELLUM_SMTP_URL is set; otherwise messages are written to the server log so a self-hoster
 * can still complete password resets and invites without configuring email.
 */
export function createMailer(env: NodeJS.ProcessEnv, log: FastifyBaseLogger): Mailer {
  const url = env.VELLUM_SMTP_URL;
  const from = env.VELLUM_MAIL_FROM ?? "Vellum <no-reply@localhost>";
  if (!url) {
    return {
      configured: false,
      async send(to, subject, text) {
        log.info({ to, subject }, `email (SMTP not configured):\n${text}`);
      },
    };
  }
  const transport = nodemailer.createTransport(url);
  return {
    configured: true,
    async send(to, subject, text) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}
