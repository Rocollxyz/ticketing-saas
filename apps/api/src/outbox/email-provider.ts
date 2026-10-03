/**
 * Abstracción de envío de email (mismo patrón que PaymentProvider). En dev usamos
 * FileEmailProvider (escribe a disco); en producción se enchufaría SES/SMTP sin
 * tocar el worker.
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
