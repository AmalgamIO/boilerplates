import { describe, it, expect } from 'vitest';
import { handler } from '@app/hello';

describe('hello.ts Lambda', () => {
  it('should return hello message', async () => {
    const res = await handler();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe('Ola!');
  });
});
