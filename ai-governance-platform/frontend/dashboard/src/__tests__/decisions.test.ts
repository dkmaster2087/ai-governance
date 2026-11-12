import { describe, expect, it } from 'vitest';
import { describeDecision } from '../lib/decisions';

const base = { app: 'billing-api', model: 'gpt-4o' };

describe('one line per decision', () => {
  it('never calls a refused request delivered', () => {
    expect(describeDecision({ ...base, outcome: 'delivered', unanswered: true })).toEqual({ verb: 'Not answered', tone: 'ink', text: 'a billing-api request was sent to gpt-4o, which refused or failed.' });
    expect(describeDecision({ ...base, outcome: 'cleaned', unanswered: true }).text).toBe('a billing-api prompt was cleaned of personal data and sent to gpt-4o, which refused or failed.');
  });

  it('describes an agent’s tool call as a call, not a prompt', () => {
    const mcp = { server: 'people', tool: 'getPerson' };
    expect(describeDecision({ ...base, model: 'mcp:people/getPerson', outcome: 'cleaned', mcp })).toEqual({ verb: 'Called', tone: 'ink', text: 'getPerson on people for billing-api; personal data removed from the result.' });
    expect(describeDecision({ ...base, outcome: 'stopped', reason: 'No payroll', mcp }).text).toBe('a call to getPerson on people: No payroll.');
    expect(describeDecision({ ...base, outcome: 'delivered', unanswered: true, mcp }).verb).toBe('Not answered');
  });

  it('keeps the usual sentences for prompts', () => {
    expect(describeDecision({ ...base, outcome: 'cleaned' })).toMatchObject({ verb: 'Cleaned', text: 'personal data from a billing-api prompt, then sent it to gpt-4o.' });
    expect(describeDecision({ ...base, outcome: 'delivered' })).toMatchObject({ verb: 'Delivered', tone: 'muted' });
  });

  it('says when a sent prompt was flagged as a possible prompt attack', () => {
    expect(describeDecision({ ...base, outcome: 'delivered', flagged: true })).toEqual({ verb: 'Flagged', tone: 'ink', text: 'a billing-api request to gpt-4o as a possible prompt attack; it was sent.' });
    expect(describeDecision({ ...base, outcome: 'cleaned', flagged: true, removed: { personalData: true } }).text).toBe('personal data from a billing-api prompt, then sent it to gpt-4o. Flagged as a possible prompt attack.');
  });

  it('names the other gateway a request was checked for', () => {
    expect(describeDecision({ ...base, outcome: 'cleaned', removed: { personalData: true }, via: { gateway: 'LiteLLM', phase: 'prompt' } }).text)
      .toBe('personal data from a billing-api prompt, then sent it to gpt-4o, through LiteLLM.');
    expect(describeDecision({ ...base, model: 'unknown', outcome: 'delivered', via: { gateway: 'Kong', phase: 'prompt' } }).text)
      .toBe('a billing-api request to a model with no findings, through Kong.');
    expect(describeDecision({ ...base, outcome: 'delivered', via: { gateway: 'Portkey', phase: 'answer' } }))
      .toEqual({ verb: 'Cleaned', tone: 'ink', text: 'an answer to a billing-api request through Portkey; secrets or personal data removed.' });
  });
});
