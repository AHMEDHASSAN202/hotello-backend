import { createTransport, Transporter } from 'nodemailer';
import { MailDriver, MailMessage } from './mail.interface';

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  fromAddress: string;
  fromName: string;
}

/** Generic SMTP transport (Story 6.2 AC1) — provider set entirely by env. */
export class SmtpMailDriver implements MailDriver {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.user
        ? { user: options.user, pass: options.pass }
        : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: `"${this.options.fromName}" <${this.options.fromAddress}>`,
      to: message.toName
        ? `"${message.toName}" <${message.to}>`
        : message.to,
      subject: message.subject,
      html: message.html,
    });
  }
}
