import { findPhi, findPii } from '../../policy/services/detectors';

const hit = (text: string, types: string[] = []) => findPii(text, types)?.label ?? null;

describe('personal data', () => {
  it('finds the usual personal data', () => {
    expect(hit('mail me at jane.doe@acme.com')).toBe('EMAIL');
    expect(hit('SSN 123-45-6789')).toBe('SSN');
    expect(hit('ssn: 123456789')).toBe('SSN');
    expect(hit('call (415) 555-0132')).toBe('PHONE');
    expect(hit('call +1 415-555-0132')).toBe('PHONE');
    expect(hit('card 4111 1111 1111 1111')).toBe('CREDIT CARD');
  });
  it('leaves order numbers, short numbers, dates and invalid cards alone', () => {
    for (const ok of ['order 123456789', 'ticket 5550132', 'version 1.2.3', 'meeting on 11/20/2026', 'ref 4111 1111 1111 1112', 'SSN 000-12-3456']) expect(hit(ok)).toBeNull();
  });
  it('finds names and dates of birth only when a rule asks, and dates only when labelled', () => {
    expect(hit('Jane Doe called')).toBeNull();
    expect(hit('Jane Doe called', ['NAME'])).toBe('NAME');
    expect(hit('meeting on 11/20/2026', ['DATE_OF_BIRTH'])).toBeNull();
    expect(hit('DOB: 04/12/1961', ['DATE_OF_BIRTH'])).toBe('DATE OF BIRTH');
    expect(hit('born on March 3, 1990', ['DATE_OF_BIRTH'])).toBe('DATE OF BIRTH');
  });
});

describe('protected health information', () => {
  it('needs health details and an identifier together', () => {
    expect(findPhi('MRN 00123456 diagnosed with asthma')?.label).toBe('MEDICAL RECORD NUMBER');
    expect(findPhi('Patient Maria Lopez takes 20mg atorvastatin')?.label).toBe('PATIENT NAME');
    expect(findPhi('Policy number H12345678, chemotherapy scheduled')?.label).toBe('HEALTH PLAN ID');
    expect(findPhi('takes metformin 500mg twice daily')).toBeNull(); // no one identified
    expect(findPhi('MRN 00123456, please update the address')).toBeNull(); // no health detail
  });
});
