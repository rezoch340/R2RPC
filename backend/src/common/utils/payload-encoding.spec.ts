import { encodePayload, decodePayload } from './payload-encoding';

describe('payload-encoding', () => {
  it('round-trips gzip+base64+json', () => {
    const payload = {
      encode_str: 'xxx',
      n: 42,
      nested: { a: [1, 2, 3] },
    };
    expect(decodePayload(encodePayload(payload))).toEqual(payload);
  });
});
