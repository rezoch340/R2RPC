import { hashPassword, verifyPassword } from './password';

describe('password (scrypt)', () => {
  it('verifies the correct password and rejects wrong ones', () => {
    const hash = hashPassword('s3cret-pw');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('s3cret-pw', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects malformed stored hashes', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});
