const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.LOG_FILE = path.join(os.tmpdir(), 'dytallix-faucet-test.log');
process.env.RPC_ENDPOINT = 'http://127.0.0.1:3030';

const request = require('supertest');
const axios = require('axios');
const { execFile } = require('child_process');

jest.mock('axios');
jest.mock('child_process', () => ({ execFile: jest.fn() }));

const app = require('../src/server');

describe('dytallix-faucet API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Mock the dytallix CLI: succeed and emit a fake tx hash on stdout.
    execFile.mockImplementation((file, args, opts, cb) =>
      cb(null, {
        stdout: `Transaction submitted 0x${'a'.repeat(64)}\nTransaction confirmed`,
        stderr: '',
      })
    );
  });

  test('GET /health returns service health', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.service).toBe('dytallix-faucet');
  });

  test('GET /api/info returns dual-token metadata', async () => {
    const response = await request(app).get('/api/info');

    expect(response.status).toBe(200);
    expect(response.body.tokenSystem).toContain('Dual Token');
    expect(response.body.tokens.DGT.amount).toBeDefined();
    expect(response.body.tokens.DRT.amount).toBeDefined();
  });

  test('POST /api/faucet rejects invalid addresses', async () => {
    const response = await request(app)
      .post('/api/faucet')
      .set('User-Agent', 'jest')
      .set('X-Forwarded-For', '203.0.113.1')
      .send({ address: 'invalid-address', tokenType: 'both' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
  });

  test('POST /api/faucet/request dispenses DRT via a signed transfer', async () => {
    const addr = 'dytallix1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    const response = await request(app)
      .post('/api/faucet/request')
      .set('User-Agent', 'jest')
      .set('X-Forwarded-For', '203.0.113.2')
      .send({ address: addr, tokenType: 'DRT' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.tokenType).toBe('DRT');
    expect(response.body.transactions).toHaveLength(1);
    // Dispensed via a signed CLI transfer, not the admin mint endpoint.
    expect(execFile).toHaveBeenCalled();
    const [bin, args] = execFile.mock.calls[0];
    expect(bin).toBe('dytallix');
    expect(args).toEqual(
      expect.arrayContaining(['send', addr, '--token', 'drt', '--from', 'faucet-hot'])
    );
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('POST /api/faucet/request rejects DGT (genesis-only token)', async () => {
    const response = await request(app)
      .post('/api/faucet/request')
      .set('User-Agent', 'jest')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({
        address: 'dytallix1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        tokenType: 'DGT',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('DGT not available from faucet');
    expect(execFile).not.toHaveBeenCalled();
  });

  test('GET /api/balance rejects malformed addresses without hitting the node', async () => {
    const response = await request(app).get('/api/balance/not-a-valid-address');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid address format');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('GET /api/balance proxies the node for valid addresses', async () => {
    axios.get.mockResolvedValue({ data: { balances: {} } });
    const address = 'dytallix1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

    const response = await request(app).get(`/api/balance/${address}`);

    expect(response.status).toBe(200);
    expect(axios.get).toHaveBeenCalledWith(
      `http://127.0.0.1:3030/balance/${address}`
    );
  });

  test('GET /api/status reports degraded when the node is unavailable', async () => {
    axios.get.mockRejectedValue(new Error('node offline'));

    const response = await request(app).get('/api/status');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.network.connected).toBe(false);
  });
});