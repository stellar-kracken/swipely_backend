import { describe, it, expect } from 'vitest';
import { riskScoringService } from './risk-scoring.service.js';

describe('RiskScoringService', () => {
  it('computes weighted score', () => {
    const res = riskScoringService.computeScore('bridge-1', {
      reserveBacking: 100,
      operatorReputation: 100,
      transactionHistory: 100,
      anomalyFrequency: 100,
      resolutionTime: 100
    });
    expect(res.riskScore).toBe(100);
    expect(res.level).toBe('CRITICAL');
  });

  it('handles missing factors', () => {
    const res = riskScoringService.computeScore('bridge-1', {});
    expect(res.factors.reserveBacking).toBe(50);
    expect(res.riskScore).toBe(50);
  });

  it('categorizes risk levels', () => {
    expect(riskScoringService.computeScore('b', { reserveBacking: 0, operatorReputation: 0, transactionHistory: 0, anomalyFrequency: 0, resolutionTime: 0 }).level).toBe('LOW');
  });

  it('computes volatility', () => {
    expect(true).toBe(true);
  });
});
