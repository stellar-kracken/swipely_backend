# Bridge Watch Alerting Runbook

## Overview

This runbook provides operational guidance for responding to Bridge Watch alerts and outages. It maps alert types to specific response procedures, escalation paths, and recovery steps.

## Table of Contents

1. [Alert Severity Levels](#alert-severity-levels)
2. [Alert Types & Response Procedures](#alert-types--response-procedures)
3. [Escalation Paths](#escalation-paths)
4. [Recovery Checklists](#recovery-checklists)
5. [Owner Contacts](#owner-contacts)
6. [Example Incidents](#example-incidents)
7. [Follow-up Tasks](#follow-up-tasks)
8. [Maintenance Notes](#maintenance-notes)

---

## Alert Severity Levels

### Critical
- **Response Time**: Immediate (< 5 minutes)
- **Impact**: Service degradation or data integrity issues
- **Escalation**: Automatic page to on-call engineer
- **Examples**: Bridge downtime, supply mismatch > 10%

### High
- **Response Time**: < 15 minutes
- **Impact**: Potential service degradation
- **Escalation**: Slack notification + email
- **Examples**: Health score drop > 20%, reserve ratio breach

### Medium
- **Response Time**: < 1 hour
- **Impact**: Monitoring anomaly, no immediate user impact
- **Escalation**: Slack notification
- **Examples**: Volume anomaly, minor price deviation

### Low
- **Response Time**: < 4 hours
- **Impact**: Informational, trend monitoring
- **Escalation**: Email digest
- **Examples**: Minor metric fluctuations

---

## Alert Types & Response Procedures

### 1. Supply Mismatch

**Alert Type**: `supply_mismatch`  
**Typical Severity**: Critical / High  
**Description**: Detected mismatch between Stellar supply and source chain reserves

#### Immediate Actions

1. **Verify the Alert**
   ```bash
   # Check current supply data
   curl -X GET https://api.bridge-watch.io/api/v1/assets/{assetCode}/supply
   
   # Compare with source chain
   curl -X GET https://api.bridge-watch.io/api/v1/supply-chain/{assetCode}/verification
   ```

2. **Assess Severity**
   - < 1% mismatch: Monitor, may be timing/sync issue
   - 1-5% mismatch: Investigate immediately
   - > 5% mismatch: **CRITICAL** - Escalate immediately

3. **Check Recent Transactions**
   ```bash
   # Review recent bridge transactions
   curl -X GET https://api.bridge-watch.io/api/v1/transactions?assetCode={assetCode}&limit=50
   ```

4. **Verify Data Sources**
   - Check Horizon API status: https://horizon.stellar.org/
   - Check source chain RPC status (Ethereum, etc.)
   - Review price feed health

#### Investigation Steps

1. **Check for Known Issues**
   - Review incident feed: `/api/v1/incidents?status=open`
   - Check bridge operator status pages
   - Review recent deployments or maintenance windows

2. **Analyze Supply Chain**
   ```bash
   # Get detailed supply chain breakdown
   curl -X GET https://api.bridge-watch.io/api/v1/supply-chain/{assetCode}/breakdown
   ```

3. **Review Audit Logs**
   ```bash
   # Check for suspicious activity
   curl -X GET https://api.bridge-watch.io/api/v1/admin/audit?resourceType=supply_verification&limit=100
   ```

#### Resolution Steps

1. **If Data Sync Issue**:
   - Trigger manual verification job
   - Wait for next scheduled verification (every 5 minutes)
   - Monitor for resolution

2. **If Legitimate Mismatch**:
   - Create incident: `POST /api/v1/incidents`
   - Notify bridge operator immediately
   - Document findings in incident description
   - Monitor for operator response

3. **If False Positive**:
   - Adjust alert threshold if needed
   - Document in runbook updates
   - Consider cooldown period adjustment

#### Escalation Criteria

- Mismatch > 5%: Escalate to Bridge Operator + Engineering Lead
- Mismatch persists > 30 minutes: Escalate to Executive Team
- User funds at risk: Escalate to Security Team + Legal

#### Recovery Checklist

- [ ] Supply mismatch resolved to < 0.5%
- [ ] Root cause identified and documented
- [ ] Incident report filed
- [ ] Alert thresholds reviewed
- [ ] Post-mortem scheduled (if critical)

---

### 2. Bridge Downtime

**Alert Type**: `bridge_downtime`  
**Typical Severity**: Critical  
**Description**: Bridge service is unresponsive or degraded

#### Immediate Actions

1. **Confirm Downtime**
   ```bash
   # Check bridge health endpoint
   curl -X GET https://api.bridge-watch.io/api/v1/bridges/{bridgeId}/health
   
   # Check recent health scores
   curl -X GET https://api.bridge-watch.io/api/v1/health?bridgeId={bridgeId}&limit=10
   ```

2. **Assess Impact**
   - Check active transaction count
   - Review pending transfers
   - Identify affected assets

3. **Check External Status**
   - Bridge operator status page
   - Social media announcements
   - Community channels (Discord, Telegram)

#### Investigation Steps

1. **Identify Failure Point**
   - API endpoint failures
   - Smart contract issues
   - Network connectivity problems
   - Rate limiting or throttling

2. **Review Monitoring Data**
   ```bash
   # Check circuit breaker status
   curl -X GET https://api.bridge-watch.io/api/v1/circuit-breaker/status
   
   # Review recent alerts
   curl -X GET https://api.bridge-watch.io/api/v1/alerts?bridgeId={bridgeId}&limit=20
   ```

3. **Check Dependencies**
   - Stellar Horizon availability
   - Source chain RPC availability
   - Price feed services
   - Database connectivity

#### Resolution Steps

1. **If Bridge Watch Issue**:
   - Check application logs
   - Review worker status
   - Restart failed services if needed
   - Verify database connections

2. **If Bridge Operator Issue**:
   - Create incident with severity: critical
   - Notify users via status page
   - Monitor operator communications
   - Track estimated recovery time

3. **If Network Issue**:
   - Verify Stellar network status
   - Check source chain status
   - Monitor for network recovery
   - Resume monitoring when stable

#### Escalation Criteria

- Downtime > 15 minutes: Escalate to Engineering Lead
- Downtime > 1 hour: Escalate to Executive Team + Communications
- User funds stuck: Escalate to Security Team immediately

#### Recovery Checklist

- [ ] Bridge health score > 80
- [ ] All pending transactions processed
- [ ] No new downtime alerts for 30 minutes
- [ ] Incident status updated to "resolved"
- [ ] User communication sent (if applicable)
- [ ] Root cause analysis completed

---

### 3. Health Score Drop

**Alert Type**: `health_score_drop`  
**Typical Severity**: High / Medium  
**Description**: Bridge health score dropped significantly

#### Immediate Actions

1. **Check Current Health Score**
   ```bash
   # Get current health score
   curl -X GET https://api.bridge-watch.io/api/v1/health/{bridgeId}
   
   # Get health score history
   curl -X GET https://api/v1/health-score-history/{bridgeId}?period=24h
   ```

2. **Identify Contributing Factors**
   - Supply verification failures
   - Transaction processing delays
   - API response time degradation
   - Reserve commitment issues

3. **Assess Trend**
   - Sudden drop vs. gradual decline
   - Isolated incident vs. pattern
   - Single bridge vs. multiple bridges

#### Investigation Steps

1. **Review Health Components**
   - Supply verification score
   - Transaction success rate
   - API availability
   - Reserve backing ratio

2. **Check Related Alerts**
   ```bash
   # Get alerts for the same bridge
   curl -X GET https://api.bridge-watch.io/api/v1/alerts?bridgeId={bridgeId}&hours=24
   ```

3. **Compare with Historical Data**
   - Review 7-day average
   - Identify anomalies
   - Check for recurring patterns

#### Resolution Steps

1. **If Temporary Degradation**:
   - Monitor for recovery
   - Document in incident notes
   - No immediate action needed if recovering

2. **If Persistent Issue**:
   - Create incident
   - Investigate root cause
   - Contact bridge operator if needed
   - Adjust monitoring thresholds if appropriate

3. **If Multiple Bridges Affected**:
   - Check for systemic issues
   - Review Bridge Watch infrastructure
   - Verify data source availability

#### Escalation Criteria

- Health score < 50: Escalate to Engineering Lead
- Health score < 30: Escalate to Executive Team
- Multiple bridges affected: Escalate to Infrastructure Team

#### Recovery Checklist

- [ ] Health score returned to > 70
- [ ] Root cause identified
- [ ] Monitoring adjusted if needed
- [ ] Incident documented
- [ ] Trend analysis completed

---

### 4. Price Deviation

**Alert Type**: `price_deviation`  
**Typical Severity**: Medium / Low  
**Description**: Asset price deviated significantly from expected value

#### Immediate Actions

1. **Verify Price Data**
   ```bash
   # Check current prices from multiple sources
   curl -X GET https://api.bridge-watch.io/api/v1/price-feeds/{assetCode}
   
   # Compare with external sources
   curl -X GET https://api.bridge-watch.io/api/v1/price-feeds/{assetCode}/comparison
   ```

2. **Assess Market Conditions**
   - Check for market volatility
   - Review trading volume
   - Verify liquidity pools

3. **Identify Affected Assets**
   - Single asset vs. multiple assets
   - Correlated movements
   - Market-wide event

#### Investigation Steps

1. **Check Price Feed Sources**
   - Verify all price feeds are operational
   - Check for stale data
   - Review feed update timestamps

2. **Review Market Activity**
   ```bash
   # Check recent trades
   curl -X GET https://api.bridge-watch.io/api/v1/pools/{assetCode}/trades?limit=50
   
   # Check liquidity depth
   curl -X GET https://api.bridge-watch.io/api/v1/pools/{assetCode}/depth
   ```

3. **Analyze Deviation Pattern**
   - Sudden spike vs. gradual drift
   - Temporary vs. sustained
   - Isolated vs. correlated

#### Resolution Steps

1. **If Data Quality Issue**:
   - Identify faulty price feed
   - Disable problematic source
   - Trigger price feed refresh
   - Monitor for stabilization

2. **If Legitimate Market Movement**:
   - Document market event
   - Adjust alert thresholds if needed
   - Monitor for further volatility
   - No action required

3. **If Oracle Manipulation**:
   - **CRITICAL**: Escalate immediately
   - Disable affected price feeds
   - Notify security team
   - Create security incident

#### Escalation Criteria

- Deviation > 20%: Escalate to Trading Team
- Suspected manipulation: Escalate to Security Team immediately
- Multiple assets affected: Escalate to Engineering Lead

#### Recovery Checklist

- [ ] Price deviation < 5%
- [ ] All price feeds operational
- [ ] Market conditions normalized
- [ ] Alert thresholds reviewed
- [ ] Incident documented

---

### 5. Volume Anomaly

**Alert Type**: `volume_anomaly`  
**Typical Severity**: Medium  
**Description**: Unusual trading or transfer volume detected

#### Immediate Actions

1. **Verify Volume Data**
   ```bash
   # Check current volume
   curl -X GET https://api.bridge-watch.io/api/v1/analytics/volume?assetCode={assetCode}&period=24h
   
   # Compare with historical average
   curl -X GET https://api.bridge-watch.io/api/v1/analytics/volume/comparison?assetCode={assetCode}
   ```

2. **Identify Volume Type**
   - Bridge transfers
   - DEX trading
   - Wallet movements
   - Smart contract interactions

3. **Assess Pattern**
   - Sudden spike vs. sustained increase
   - Organic growth vs. suspicious activity
   - Single source vs. distributed

#### Investigation Steps

1. **Analyze Transaction Patterns**
   ```bash
   # Get recent high-volume transactions
   curl -X GET https://api.bridge-watch.io/api/v1/transactions?assetCode={assetCode}&sort=amount&limit=50
   ```

2. **Check for Known Events**
   - Marketing campaigns
   - Partnership announcements
   - Protocol upgrades
   - Market events

3. **Review User Behavior**
   - New user influx
   - Whale activity
   - Bot activity patterns
   - Wash trading indicators

#### Resolution Steps

1. **If Organic Growth**:
   - Document event
   - Update baseline metrics
   - Adjust alert thresholds
   - Monitor for sustainability

2. **If Suspicious Activity**:
   - Flag transactions for review
   - Monitor for wash trading
   - Check for Sybil attacks
   - Document patterns

3. **If Attack or Exploit**:
   - **CRITICAL**: Escalate immediately
   - Trigger circuit breaker if needed
   - Notify security team
   - Preserve evidence

#### Escalation Criteria

- Volume spike > 500%: Escalate to Analytics Team
- Suspected wash trading: Escalate to Compliance Team
- Potential exploit: Escalate to Security Team immediately

#### Recovery Checklist

- [ ] Volume pattern understood
- [ ] No suspicious activity detected
- [ ] Baseline metrics updated
- [ ] Alert thresholds adjusted
- [ ] Incident documented

---

### 6. Reserve Ratio Breach

**Alert Type**: `reserve_ratio_breach`  
**Typical Severity**: Critical / High  
**Description**: Bridge reserves fell below required ratio

#### Immediate Actions

1. **Verify Reserve Status**
   ```bash
   # Check current reserves
   curl -X GET https://api.bridge-watch.io/api/v1/bridges/{bridgeId}/reserves
   
   # Get reserve commitments
   curl -X GET https://api.bridge-watch.io/api/v1/bridge-registry/{bridgeId}/commitments
   ```

2. **Calculate Shortfall**
   - Required reserves
   - Current reserves
   - Deficit amount
   - Percentage breach

3. **Check Recent Activity**
   - Large withdrawals
   - Failed deposits
   - Reserve rebalancing
   - Operator actions

#### Investigation Steps

1. **Review Reserve History**
   ```bash
   # Get reserve history
   curl -X GET https://api.bridge-watch.io/api/v1/bridges/{bridgeId}/reserves/history?period=7d
   ```

2. **Verify On-Chain Data**
   - Check source chain balances
   - Verify Merkle commitments
   - Review challenge history
   - Check slash events

3. **Assess Risk Level**
   - User funds at risk
   - Operator solvency
   - Market impact
   - Regulatory implications

#### Resolution Steps

1. **If Temporary Shortfall**:
   - Monitor for operator rebalancing
   - Track reserve replenishment
   - Document timeline
   - Verify resolution

2. **If Persistent Breach**:
   - Create critical incident
   - Notify users immediately
   - Contact bridge operator
   - Consider service suspension

3. **If Operator Insolvency**:
   - **CRITICAL**: Escalate to executive team
   - Notify regulatory authorities
   - Preserve evidence
   - Coordinate user communications
   - Initiate recovery procedures

#### Escalation Criteria

- Breach > 5%: Escalate to Risk Management Team
- Breach > 10%: Escalate to Executive Team + Legal
- Operator unresponsive: Escalate to Security Team
- User funds at risk: Escalate to all stakeholders immediately

#### Recovery Checklist

- [ ] Reserve ratio restored to > 100%
- [ ] Operator commitment verified
- [ ] User communications sent
- [ ] Regulatory notifications filed (if required)
- [ ] Post-incident review completed
- [ ] Monitoring enhanced

---

## Escalation Paths

### Level 1: On-Call Engineer
- **Trigger**: Any critical alert
- **Response Time**: < 5 minutes
- **Responsibilities**:
  - Initial triage
  - Execute runbook procedures
  - Escalate if needed

### Level 2: Engineering Lead
- **Trigger**: 
  - Critical alert unresolved after 15 minutes
  - Multiple high-severity alerts
  - Infrastructure issues
- **Response Time**: < 10 minutes
- **Responsibilities**:
  - Coordinate response
  - Make architectural decisions
  - Authorize emergency changes

### Level 3: Executive Team
- **Trigger**:
  - Critical alert unresolved after 1 hour
  - User funds at risk
  - Regulatory implications
  - Public relations impact
- **Response Time**: < 30 minutes
- **Responsibilities**:
  - Strategic decisions
  - External communications
  - Legal/regulatory coordination

### Specialized Teams

#### Security Team
- **Trigger**: Suspected exploit, manipulation, or security breach
- **Contact**: security@bridge-watch.io
- **Response Time**: Immediate

#### Compliance Team
- **Trigger**: Regulatory issues, suspicious activity
- **Contact**: compliance@bridge-watch.io
- **Response Time**: < 1 hour

#### Communications Team
- **Trigger**: Public-facing incidents, user impact
- **Contact**: comms@bridge-watch.io
- **Response Time**: < 30 minutes

---

## Recovery Checklists

### Post-Incident Recovery

- [ ] Alert resolved and verified
- [ ] Root cause identified
- [ ] Incident report filed
- [ ] User communications sent (if applicable)
- [ ] Monitoring adjusted
- [ ] Runbook updated
- [ ] Post-mortem scheduled (for critical incidents)

### Service Restoration

- [ ] All services operational
- [ ] Health scores normalized
- [ ] No active alerts
- [ ] User impact resolved
- [ ] Monitoring confirmed stable
- [ ] Stakeholders notified

### Data Integrity Verification

- [ ] Supply verification passed
- [ ] Reserve commitments verified
- [ ] Transaction history validated
- [ ] Audit logs reviewed
- [ ] No data corruption detected

---

## Owner Contacts

### Bridge Watch Team

| Role | Contact | Escalation Level |
|------|---------|------------------|
| On-Call Engineer | oncall@bridge-watch.io | Level 1 |
| Engineering Lead | eng-lead@bridge-watch.io | Level 2 |
| CTO | cto@bridge-watch.io | Level 3 |
| Security Team | security@bridge-watch.io | Specialized |
| Compliance | compliance@bridge-watch.io | Specialized |
| Communications | comms@bridge-watch.io | Specialized |

### Bridge Operators

| Bridge | Contact | Status Page |
|--------|---------|-------------|
| Circle USDC | support@circle.com | https://status.circle.com |
| Wormhole | support@wormhole.com | https://status.wormhole.com |
| Allbridge | support@allbridge.io | https://status.allbridge.io |
| Moneygram | support@moneygram.com | https://status.moneygram.com |

### External Services

| Service | Contact | Status Page |
|---------|---------|-------------|
| Stellar Network | - | https://status.stellar.org |
| Ethereum RPC | - | https://status.infura.io |
| AWS | - | https://status.aws.amazon.com |

---

## Example Incidents

### Example 1: USDC Supply Mismatch (Critical)

**Date**: 2024-12-10  
**Duration**: 45 minutes  
**Severity**: Critical

**Timeline**:
- 14:00 UTC: Alert triggered - 8% supply mismatch detected
- 14:03 UTC: On-call engineer verified mismatch
- 14:05 UTC: Escalated to Engineering Lead
- 14:10 UTC: Identified stuck Ethereum transaction
- 14:15 UTC: Contacted Circle support
- 14:30 UTC: Circle confirmed transaction processing delay
- 14:45 UTC: Transaction confirmed, supply reconciled

**Root Cause**: Ethereum network congestion caused delayed transaction confirmation

**Resolution**: Waited for transaction confirmation, verified supply reconciliation

**Follow-up**:
- Adjusted alert threshold to account for network delays
- Implemented transaction monitoring dashboard
- Added Ethereum gas price monitoring

---

### Example 2: Bridge Downtime (Critical)

**Date**: 2024-11-15  
**Duration**: 2 hours  
**Severity**: Critical

**Timeline**:
- 09:00 UTC: Bridge health check failures detected
- 09:02 UTC: Confirmed bridge API unresponsive
- 09:05 UTC: Escalated to Engineering Lead
- 09:10 UTC: Checked bridge operator status page - maintenance announced
- 09:15 UTC: Created incident, notified users
- 11:00 UTC: Bridge operator completed maintenance
- 11:05 UTC: Verified bridge operational, resolved incident

**Root Cause**: Scheduled maintenance by bridge operator (not communicated in advance)

**Resolution**: Waited for maintenance completion

**Follow-up**:
- Requested advance notice for future maintenance
- Implemented maintenance window tracking
- Enhanced user notification system

---

### Example 3: Price Deviation (Medium)

**Date**: 2024-10-20  
**Duration**: 30 minutes  
**Severity**: Medium

**Timeline**:
- 16:00 UTC: Price deviation alert - EURC 15% above expected
- 16:02 UTC: Verified price across multiple sources
- 16:05 UTC: Identified single price feed reporting stale data
- 16:10 UTC: Disabled faulty price feed
- 16:15 UTC: Triggered price aggregation refresh
- 16:30 UTC: Price normalized, alert cleared

**Root Cause**: Price feed API timeout causing stale data

**Resolution**: Disabled faulty feed, refreshed aggregation

**Follow-up**:
- Implemented price feed staleness detection
- Added redundant price sources
- Enhanced feed health monitoring

---

## Follow-up Tasks

### Immediate (Within 24 hours)

- [ ] File incident report
- [ ] Update incident status
- [ ] Notify stakeholders
- [ ] Document lessons learned
- [ ] Update monitoring dashboards

### Short-term (Within 1 week)

- [ ] Conduct post-mortem (for critical incidents)
- [ ] Update runbook with new findings
- [ ] Implement quick fixes
- [ ] Adjust alert thresholds
- [ ] Review escalation effectiveness

### Long-term (Within 1 month)

- [ ] Implement preventive measures
- [ ] Enhance monitoring capabilities
- [ ] Update documentation
- [ ] Conduct training sessions
- [ ] Review and update SLAs

---

## Maintenance Notes

### Runbook Maintenance

- **Review Frequency**: Monthly
- **Owner**: Engineering Lead
- **Last Updated**: 2024-12-15
- **Next Review**: 2025-01-15

### Update Triggers

- New alert types added
- Escalation paths changed
- Contact information updated
- New bridge operators onboarded
- Significant incidents requiring new procedures

### Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2024-12-15 | Initial runbook creation | Bridge Watch Team |

### Feedback

Submit runbook feedback and improvement suggestions to: runbook-feedback@bridge-watch.io

---

## Quick Reference

### Critical Alert Response (< 5 minutes)

1. Acknowledge alert
2. Verify alert is legitimate
3. Assess severity and impact
4. Execute relevant runbook section
5. Escalate if unresolved in 15 minutes

### Escalation Decision Tree

```
Alert Triggered
    ├─ Can I resolve in 15 minutes?
    │   ├─ Yes → Execute runbook, monitor, document
    │   └─ No → Escalate to Engineering Lead
    │
    ├─ User funds at risk?
    │   └─ Yes → Escalate to Security + Executive immediately
    │
    ├─ Multiple services affected?
    │   └─ Yes → Escalate to Infrastructure Team
    │
    └─ Regulatory implications?
        └─ Yes → Escalate to Compliance + Legal
```

### Emergency Contacts (24/7)

- **On-Call**: oncall@bridge-watch.io
- **Security**: security@bridge-watch.io (PagerDuty)
- **Executive**: exec-oncall@bridge-watch.io

---

## Additional Resources

- [Alert Configuration Guide](./alerts-configuration.md)
- [Incident Management Process](./incident-management.md)
- [Bridge Operator Contacts](./bridge-operators.md)
- [Monitoring Dashboard](https://dashboard.bridge-watch.io)
- [Status Page](https://status.bridge-watch.io)
