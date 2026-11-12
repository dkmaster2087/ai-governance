import { allPages, collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { LicenseStatus, licenseState } from './license-state';
import { mailer, Mailer } from './email';
import { userDirectory } from './user-directory';

const logger = createLogger('gateway:license-notices');

/**
 * License notices by email to each company's admins, besides the banner on every dashboard page:
 * 30, 14, 7 and 1 days before the license ends; the same points through the 30-day grace period; and once when
 * AI requests stop. Each notice goes once, whatever the number of gateway copies; a renewal starts afresh.
 * Mail goes through this deployment's mailer (a customer-run install: their own mail server).
 */

const POINTS = [30, 14, 7, 1];

/** Which notice is due, as a key that changes when it's time for the next one; null when none is. */
export function noticeDue(s: LicenseStatus | null): string | null {
  if (!s) return null;
  if (s.state === 'lapsed') return `lapsed#${s.graceUntil ?? ''}`;
  if (s.state !== 'expiring' && s.state !== 'grace') return null;
  const days = s.daysLeft ?? 0;
  // The nearest point not yet passed: 25 days left is the 30-day notice, 10 days the 14-day one.
  const point = [...POINTS].reverse().find((p) => days <= p);
  if (point === undefined) return null;
  return `${s.state}#${s.state === 'expiring' ? s.endsAt : s.graceUntil}#${point}`;
}

const day = (iso?: string) => (iso ? new Date(iso).toUTCString().slice(5, 16) : 'soon');
const plural = (n?: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export function noticeText(s: LicenseStatus, company: string, dashboard: string): { subject: string; text: string } {
  const where = dashboard ? `\n\nOpen the License page: ${dashboard.replace(/\/$/, '')}/license` : '';
  if (s.state === 'expiring') return {
    subject: `Probaline license for ${company} ends in ${plural(s.daysLeft)}`,
    text: `The Probaline license for ${company} ends on ${day(s.endsAt)}, in ${plural(s.daysLeft)}.\n\nRenew it with Probaline so nothing stops, then enter the new license on the License page. After the end date there are 30 days of grace; then AI requests through Probaline are refused.${where}`,
  };
  if (s.state === 'grace') return {
    subject: `Probaline license for ${company} has ended: ${plural(s.daysLeft)} until AI requests stop`,
    text: `${s.reason === 'none' ? `${company} hasn't entered a Probaline license yet.` : `The Probaline license for ${company} ended${s.endedAt ? ` on ${day(s.endedAt)}` : ''}.`}\n\nEverything keeps working until ${day(s.graceUntil)}, ${plural(s.daysLeft)} from now. After that, AI requests through Probaline are refused until a license is entered on the License page.${where}`,
  };
  return {
    subject: `Probaline license for ${company} has ended: AI requests have stopped`,
    text: `The Probaline license for ${company} has ended and its grace period is over, so AI requests through Probaline stopped on ${day(s.graceUntil)}.\n\nPeople can still sign in and read evidence. Enter a renewed license on the License page and requests resume at once.${where}`,
  };
}

/** One pass over every company: send the notices that are due and haven't gone yet. */
export async function sendLicenseNotices(m: Mailer = mailer()): Promise<number> {
  if (!m.enabled) return 0;
  const dashboard = process.env.PUBLIC_GATEWAY_URL && (process.env.LICENSING ?? '').toLowerCase() === 'offline'
    ? process.env.PUBLIC_GATEWAY_URL : process.env.DASHBOARD_URL ?? '';
  const tenants = await allPages((after) => collection<{ tenantId: string; name?: string; status?: string }>('tenants').scan({ after, limit: 500 }));
  let sent = 0;
  for (const t of tenants) {
    if (t.status === 'suspended') continue;
    const status = await licenseState().get(t.tenantId);
    const due = noticeDue(status);
    if (!status || !due) continue;
    const key = { tenantId: t.tenantId, period: `license-notice#${due}` };
    // Claim it first, so several gateway copies send it once.
    const claimed = await collection('metrics').put({ ...key, ttl: Math.floor(Date.now() / 1000) + 120 * 86_400 }, { ifNotExists: true });
    if (!claimed) continue;
    const admins = (await userDirectory().list(t.tenantId)).filter((u) => u.role === 'tenant_admin' && u.status !== 'disabled').map((u) => u.email);
    if (!admins.length) continue;
    const { subject, text } = noticeText(status, t.name || t.tenantId, dashboard);
    try {
      await m.send({ to: admins, subject, text });
      sent++;
      logger.info('License notice sent', { tenantId: t.tenantId, notice: due.split('#')[0], recipients: admins.length });
    } catch (err) {
      // Not sent: free the claim so the next pass tries again.
      await collection('metrics').delete(key).catch(() => {});
      logger.warn('License notice not sent', { tenantId: t.tenantId, error: (err as Error).message });
    }
  }
  return sent;
}

export function scheduleLicenseNotices(): NodeJS.Timeout {
  const tick = () => { sendLicenseNotices().catch((err) => logger.error('License notices failed', { error: (err as Error).message })); };
  setTimeout(tick, 120_000).unref();
  const timer = setInterval(tick, 3600_000);
  timer.unref();
  return timer;
}
