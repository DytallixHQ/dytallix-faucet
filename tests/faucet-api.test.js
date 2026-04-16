process.env.NODE_ENV = 'test';
process.env.LOG_FILE = 'logs/test.log';
process.env.RPC_ENDPOINT = 'http://127.0.0.1:3030';

const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

const app = require('../src/server');

describe('dytallix-faucet API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  test('POST /api/faucet/request funds both tokens for valid requests', async () => {
    axios.post.mockResolvedValue({
      data: {
        success: true,
        credited: {
          udgt: 10000000,
          udrt: 100000000,
        },
      },
    });

    const response = await request(app)
      .post('/api/faucet/request')
      .set('User-Agent', 'jest')
      .set('X-Forwarded-For', '203.0.113.2')
      .send({
        address: 'dytallix1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        dgt_amount: 10,
        drt_amount: 100,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.tokenType).toBe('both');
    expect(response.body.transactions).toHaveLength(2);
    expect(axios.post).toHaveBeenCalledWith('http://127.0.0.1:3030/dev/faucet', {
      address: 'dytallix1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      udgt: 10000000,
      udrt: 100000000,
    });
  });

  test('GET /api/status reports degraded when the node is unavailable', async () => {
    axios.get.mockRejectedValue(new Error('node offline'));

    const response = await request(app).get('/api/status');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.network.connected).toBe(false);
  });
});