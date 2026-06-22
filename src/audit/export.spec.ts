import { describe, it, expect, vi } from 'vitest';
import { auditReportService } from './audit-report.service';
import { auditRepository } from './audit.repository';

vi.mock('./audit.repository');

describe('ExportService', () => {
  it('exports CSV', async () => {
    vi.mocked(auditRepository.findEvents).mockResolvedValue([
      { id: '1', actorId: 'user1', action: 'LOGIN', createdAt: new Date() } as any
    ]);
    
    const csv = await auditReportService.exportCsv({});
    expect(csv).toContain('user1');
    expect(csv).toContain('LOGIN');
  });

  it('exports JSON', async () => {
    vi.mocked(auditRepository.findEvents).mockResolvedValue([
      { id: '1', actorId: 'user1', action: 'LOGIN', createdAt: new Date() } as any
    ]);
    
    const json = await auditReportService.exportJson({});
    expect(JSON.parse(json)[0].actorId).toBe('user1');
  });
});
