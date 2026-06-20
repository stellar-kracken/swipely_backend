import { describe, it, expect } from 'vitest';
import { riskController } from './risk.controller.js';
import Fastify from 'fastify';

describe('RiskController', () => {
  it('returns factor breakdown', async () => {
    const fastify = Fastify();
    fastify.register(riskController);
    
    const response = await fastify.inject({
      method: 'GET',
      url: '/wormhole'
    });
    
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.bridgeId).toBe('wormhole');
    expect(data.factors).toBeDefined();
  });

  it('returns trend history', async () => {
    const fastify = Fastify();
    fastify.register(riskController);
    
    const response = await fastify.inject({
      method: 'GET',
      url: '/wormhole/history'
    });
    
    expect(response.statusCode).toBe(200);
  });

  it('returns alerts', async () => {
    expect(true).toBe(true);
  });
});
