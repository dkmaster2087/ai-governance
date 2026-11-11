import type { RuleMatch } from './evidence';

type TextMatch = Extract<RuleMatch, { kind: 'text' }>;

/**
 * What the personal-data and health-data rules look for. Patterns are deliberately specific: a rule that
 * stops ordinary work ("New York", a meeting date, an order number) gets switched off, which protects nobody.
 */

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};

type Finder = (text: string) => { index: number; length: number } | null;
const re = (pattern: RegExp, check?: (m: RegExpExecArray) => boolean): Finder => (text) => {
  const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (!check || check(m)) return { index: m.index, length: m[0].length };
    if (m[0].length === 0) g.lastIndex++;
  }
  return null;
};

const DATE = String.raw`(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4})`;

/** Personal-data types a rule can name. */
export const PII_FINDERS: Record<string, Finder> = {
  EMAIL: re(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/),
  // With the usual separators, or labelled: a bare nine-digit number is usually an order or account number.
  SSN: re(/\b(?:\d{3}-\d{2}-\d{4}|(?:ssn|social security(?: number| no\.?)?)[:#\s]*\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/i, (m) => !/^(000|666|9)/.test(m[0].replace(/\D/g, ''))),
  // A full number with area code, written the way phone numbers are.
  PHONE: re(/(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/),
  CREDIT_CARD: re(/\b(?:\d[ -]?){12,18}\d\b/, (m) => { const d = m[0].replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); }),
  // Only when a rule asks for names: two capitalised words are too often a place or a title.
  NAME: re(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/),
  // Only when labelled: most dates in prompts are meetings and deadlines.
  DATE_OF_BIRTH: re(new RegExp(String.raw`\b(?:dob|d\.o\.b\.?|date of birth|birth ?date|born(?: on)?)\b[:\s]*${DATE}`, 'i')),
  MEDICAL_RECORD_NUMBER: re(/\b(?:mrn|medical record(?: number| no\.?| #)?)[:#\s]*[A-Z0-9-]{5,}\b/i),
};

/** Who health information is about: any of these makes it individually identifiable. */
const PHI_IDENTIFIERS: Array<[string, Finder]> = [
  ['MEDICAL RECORD NUMBER', PII_FINDERS.MEDICAL_RECORD_NUMBER],
  ['DATE OF BIRTH', PII_FINDERS.DATE_OF_BIRTH],
  ['SSN', PII_FINDERS.SSN],
  ['HEALTH PLAN ID', re(/\b(?:member|subscriber|policy|health plan|insurance|medicaid|medicare)\s*(?:id|#|no\.?|number)[:#\s]*[A-Z0-9-]{5,}\b/i)],
  ['EMAIL', PII_FINDERS.EMAIL],
  ['PHONE', PII_FINDERS.PHONE],
  // The label in any case; the name itself capitalised.
  ['PATIENT NAME', re(/\b(?:[Pp]atient(?: [Nn]ame)?|[Pp]t|[Nn]ame|M[Rr]s?|M[Ss]|Miss)\b[.:]?\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/)],
];

/** Health information: conditions, codes, medications, results, care. */
const HEALTH_CONTEXT: Finder[] = [
  re(/\b(?:diagnos[ie]s|diagnosed|dx|prognosis|icd-?10|cpt)\b/i),
  re(/\b[A-TV-Z][0-9][0-9AB]\.[0-9A-TV-Z]{1,4}\b/), // an ICD-10 code with its decimal part
  re(/\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|ml|mL|units|iu|IU)\b/), // a dose
  re(/\b(?:prescri(?:bed|ption)|medication|dosage|refill|lab results?|blood (?:pressure|test|work|sugar)|a1c|hba1c|biopsy|mri|ct scan|x-ray|admitted|discharged|surgery|chemotherapy|therapy session|treatment plan|symptoms?)\b/i),
  re(/\b(?:diabetes|cancer|tumou?r|hiv|aids|hepatitis|hypertension|asthma|copd|depression|anxiety disorder|bipolar|schizophrenia|dementia|alzheimer'?s|pregnan(?:t|cy)|stroke|heart failure|kidney disease|tuberculosis|covid-19|substance use|opioid)\b/i),
];

/** The first match of the named personal-data types (or a default set), as rule evidence. */
export function findPii(text: string, types: string[]): TextMatch | null {
  const wanted = types.length ? types : ['EMAIL', 'SSN', 'PHONE', 'CREDIT_CARD'];
  for (const t of wanted) {
    const hit = PII_FINDERS[t]?.(text);
    if (hit) return { kind: 'text', index: hit.index, length: hit.length, label: t.replace(/_/g, ' ') };
  }
  return null;
}

/**
 * Protected health information: health details together with something that identifies the person.
 * Health details alone (de-identified) and identifiers alone aren't PHI. The evidence points at the identifier.
 */
export function findPhi(text: string): TextMatch | null {
  if (!HEALTH_CONTEXT.some((f) => f(text))) return null;
  for (const [label, find] of PHI_IDENTIFIERS) {
    const hit = find(text);
    if (hit) return { kind: 'text', index: hit.index, length: hit.length, label };
  }
  return null;
}
