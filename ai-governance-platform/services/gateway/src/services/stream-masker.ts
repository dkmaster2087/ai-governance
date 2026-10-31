import { ResponseScanner } from './response-scanner';

/**
 * Masks personal data in a streamed answer. Text is held back until enough has arrived that nothing still
 * being written could complete a pattern, then masked and released. HOLD covers emails, phone, card, SSN and
 * IP numbers and API keys; a pattern longer than HOLD (a whole private key block) can slip through split
 * across chunks, which is why streams also get the full scan on the complete text for the audit record.
 */
export const HOLD = 96;

export class StreamMasker {
  private pending = '';
  private scanner = new ResponseScanner();
  findings = 0;

  private mask(text: string): string {
    if (!text) return text;
    const r = this.scanner.scan(text);
    this.findings += r.findingsCount;
    return r.maskedContent;
  }

  /** Add text; returns what is safe to send now (possibly ''). */
  push(text: string): string {
    this.pending += text;
    if (this.pending.length <= HOLD) return '';
    let split = this.pending.length - HOLD;
    // Prefer to cut at whitespace so a number or address isn't split.
    const ws = this.pending.lastIndexOf(' ', split);
    const nl = this.pending.lastIndexOf('\n', split);
    const at = Math.max(ws, nl);
    if (at > 0) split = at + 1;
    const out = this.pending.slice(0, split);
    this.pending = this.pending.slice(split);
    return this.mask(out);
  }

  /** The rest, at the end of the stream. */
  end(): string {
    const out = this.mask(this.pending);
    this.pending = '';
    return out;
  }
}
