import { describe, it, expect, vi } from 'vitest';
import { auditService } from './audit.service';
import { auditRepository } from './audit.repository';

vi.mock('./audit.repository');

describe('AuditService', () => {
  it('creates an audit record and checksum chain', async () => {
    vi.mocked(auditRepository.getLatestChecksum).mockResolvedValue('prev-hash-123');
    
    const event = await auditService.log({
      actorId: 'user1',
      actorType: 'user',
      action: 'LOGIN',
      resourceType: 'auth',
      resourceId: 'session1',
    });

    expect(event.id).toBeDefined();
    expect(event.checksum).toBeDefined();
    expect(event.previousChecksum).toBe('prev-hash-123');
    expect(auditRepository.insertEvent).toHaveBeenCalledWith(event);
  });
});
