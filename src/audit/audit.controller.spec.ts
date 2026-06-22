import { describe, it, expect, vi } from 'vitest';
import { auditController } from './audit.controller';
import Fastify from 'fastify';
import { auditRepository } from './audit.repository';

vi.mock('./audit.repository');

describe('AuditController', () => {
  it('filters by actor', async () => {
    const fastify = Fastify();
    fastify.register(auditController);
    
    vi.mocked(auditRepository.findEvents).mockResolvedValue([]);
    
    const response = await fastify.inject({
      method: 'GET',
      url: '/?actor=user1'
    });
    
    expect(response.statusCode).toBe(200);
    expect(auditRepository.findEvents).toHaveBeenCalledWith({ actor: 'user1' });
  });
});
