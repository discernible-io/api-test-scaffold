# Data Retention Policy

**Effective Date**: April 5, 2026  
**Service**: IDENTYCLAW API (api.identyclaw.com)  
**Operator**: Discernible Inc.

---

## 1. Overview

This document describes how long we retain different types of data and our procedures for data deletion.

## 2. Retention Schedule

### 2.1 Ephemeral Data

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| Active sessions | Duration of session | Cleared on logout or timeout |
| JWT tokens | As per `jwt_duration` metadata | Typically 1-24 hours |
| Rate limit counters | 1 hour rolling window | Reset automatically |
| Request processing cache | 5 minutes | In-memory only |

### 2.2 Operational Data

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| API access logs | 90 days | IP, endpoint, timestamp, status |
| Authentication events | 90 days | Login, logout, verification |
| Error logs | 30 days | Stack traces, debugging info |
| Performance metrics | 30 days | Response times, throughput |
| Security events | 1 year | Suspicious activity, blocks |

### 2.3 Blockchain Data

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| RODiT token metadata | **Permanent** | Immutable on NEAR blockchain |
| Token ownership history | **Permanent** | Transfer events on blockchain |
| Minting transactions | **Permanent** | Blockchain transaction logs |

**Important**: Blockchain data cannot be deleted due to the immutable nature of distributed ledgers. Plan your `userselected_dn` content accordingly.

### 2.4 Business Records

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| Fee transactions | 7 years | Financial compliance |
| Service provider agreements | Contract term + 3 years | Legal requirements |
| Support correspondence | 2 years | Customer service records |

## 3. Deletion Procedures

### 3.1 Automatic Deletion

The following data is automatically deleted after retention period:
- Session data: Purged on expiry
- Logs: Rotated and deleted per schedule
- Cache: Expires automatically

### 3.2 User-Requested Deletion

You may request deletion of:
- ✅ API access logs associated with your account
- ✅ Support tickets and correspondence
- ✅ Cached session data
- ❌ Blockchain data (technically impossible)
- ❌ Anonymized aggregate statistics

**To request deletion**: Email privacy@identyclaw.com with subject "Data Deletion Request"

### 3.3 Token Burning

Burning a RODiT token:
- Removes the token from active circulation
- Does NOT delete historical blockchain data
- Triggers storage refund on NEAR
- Revokes associated API access

## 4. Data Minimization

We practice data minimization:
- Collect only necessary data for service operation
- Facial token IDs encode descriptive labels, not biometric data
- `userselected_dn` contains only user-provided identity attributes
- API logs exclude request/response body content

## 5. Backup and Recovery

### 5.1 Off-Chain Data
- Daily backups retained for 30 days
- Encrypted at rest
- Geographically distributed

### 5.2 Blockchain Data
- Inherently replicated across NEAR network nodes
- No centralized backup needed
- Recovery via blockchain synchronization

## 6. Data Export

You may request export of your data:
- **Format**: JSON
- **Includes**: Account info, API usage summary, token metadata
- **Processing time**: Within 30 days
- **Request**: Email privacy@identyclaw.com

## 7. Third-Party Data Processors

| Processor | Data Type | Purpose | Retention |
|-----------|-----------|---------|-----------|
| NEAR Protocol | Token metadata | Blockchain storage | Permanent |
| Cloud hosting | Logs, sessions | Service operation | Per schedule above |
| Analytics | Aggregated metrics | Performance monitoring | 30 days |

## 8. Compliance

This policy is designed to comply with:
- **GDPR** (EU General Data Protection Regulation)
- **CCPA** (California Consumer Privacy Act)
- **LGPD** (Brazil General Data Protection Law)

## 9. Changes to This Policy

We will notify users of material changes to retention periods with 30 days advance notice.

## 10. Contact

**Data Protection Inquiries**:  
Email: privacy@identyclaw.com

**Deletion Requests**:  
Email: privacy@identyclaw.com  
Subject: "Data Deletion Request"

---

*Last Updated: April 5, 2026*
