import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('./http', () => ({ http: mock.http }));
import { indexedTokens } from './portfolio-index';
const wallet = `0x${'11'.repeat(20)}`, token = `0x${'22'.repeat(20)}`;
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it('paginates indexed ERC-20 contracts and excludes zero balances and failed entries', async () => {
  vi.stubEnv('ALCHEMY_API_KEY', 'test');
  mock.http.mockResolvedValueOnce({ result: { tokenBalances: [{ contractAddress: token, tokenBalance: '0x1' }, { contractAddress: wallet, tokenBalance: '0x0' }], pageKey: 'next' } }).mockResolvedValueOnce({ result: { tokenBalances: [{ contractAddress: token, tokenBalance: '0x2' }, { contractAddress: wallet, tokenBalance: null, error: 'unavailable' }] } });
  expect(await indexedTokens(8453, wallet)).toEqual({ tokens: [token], complete: true });
  expect(mock.http.mock.calls[1][2].body.params).toEqual([wallet, 'erc20', { maxCount: 100, pageKey: 'next' }]);
});
it('reports incomplete coverage when discovery is not configured', async () => {
  vi.stubEnv('ALCHEMY_API_KEY', '');
  expect(await indexedTokens(8453, wallet)).toEqual({ tokens: [], complete: false });
  expect(mock.http).not.toHaveBeenCalled();
});
it('rejects an indexer failure rather than calling it an empty portfolio', async () => {
  vi.stubEnv('ALCHEMY_API_KEY', 'test'); mock.http.mockResolvedValue({ error: { code: -32000 } });
  await expect(indexedTokens(8453, wallet)).rejects.toThrow('unavailable');
});
