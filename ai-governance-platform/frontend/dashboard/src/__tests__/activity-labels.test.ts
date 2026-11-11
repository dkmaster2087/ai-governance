import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_LABEL } from '../pages/ActivityPage';

// The gateway names each admin action and sign-in; the Activity page must say each one in plain words.
const gateway = path.resolve(__dirname, '../../../../services/gateway/src/activity');
const recorded = (file: string, pattern: RegExp) => [...fs.readFileSync(path.join(gateway, file), 'utf8').matchAll(pattern)].map((m) => m[1]);

describe('Activity labels', () => {
  it('has plain words for every action the gateway records', () => {
    const actions = new Set([
      ...recorded('admin-activity.ts', /':\s*'([a-z_]+\.[a-z_]+)'/g),
      ...recorded('sign-ins.ts', /'(sign_in\.[a-z_]+)'/g),
    ]);
    expect(actions.size).toBeGreaterThan(40);
    expect([...actions].filter((a) => !ACTION_LABEL[a])).toEqual([]);
  });
});
