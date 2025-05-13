import { describe, it, expect } from 'vitest';
import { handler } from '@app/goodbye';

describe('goodbye.js Lambda', () => {
  it('should return goodbye message', async () => {
    const res = await handler();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe('Ciao!');
  });
});