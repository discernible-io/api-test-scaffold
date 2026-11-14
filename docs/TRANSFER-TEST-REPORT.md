# Transfer ownership test report (C4)

Dated results from **one real mainnet round-trip** of `rodit_transfer`, with the paired API login outcomes screeners need: **old owner login FAIL** + **new owner login PASS** from the same transfer.

This closes the app proof-sheet **C4** deferral for submission without wiring `transferOwnership` into the scaffold CI matrix, and without pulling QR/HOLA into the story.

## Run metadata

| Field | Value |
|-------|--------|
| **Date (UTC)** | 2026-11-14T18:27:46Z → 2026-11-14T18:29:10Z |
| **Contract** | `genaaaa-identyclaw-com.near` |
| **Token id** | `cdcqsfbrsncj` |
| **API host** | `https://api.identyclaw.com` |
| **From (old owner)** | `24c0ecfe…90c4c3c3` |
| **To (new owner)** | `2e936b69…d53ee552` (disposable implicit account created for this run) |
| **Tools** | `examples/native-login.js`, `infra/idcp-wallet.sh` / `near-cli-rs`, public RPC `mainnet-fastnear` |
| **Secrets** | **No keys committed.** Credentials stayed under `~/.near-credentials/mainnet/` only. Report lists truncated account ids, JWT `jti`, HTTP statuses, and explorer hashes — never JWTs or private keys. |

Round-trip: Passport returned to the original owner after the login pairing (step 6).

## Results

| Step | What was tested | Result | Evidence |
|------|-----------------|--------|----------|
| 1 | Login as current owner | **PASS** — JWT + `GET /api/me/identity` 200 | UTC `2026-11-14T18:27:46.994Z`; API `api.identyclaw.com`; `tokenId=cdcqsfbrsncj`; JWT `jti=jti01M7DN1JE2NRT058X5PE6QE03H` |
| 2 | `rodit_transfer` to second account | **PASS** | [nearblocks `4RYaXma5qTUk5PgvfdKJBdDuEMGrEeQquBHez8dQ5G6n`](https://nearblocks.io/txns/4RYaXma5qTUk5PgvfdKJBdDuEMGrEeQquBHez8dQ5G6n) · [explorer](https://explorer.near.org/transactions/4RYaXma5qTUk5PgvfdKJBdDuEMGrEeQquBHez8dQ5G6n) |
| 3 | `rodit_token.owner_id` is new account | **PASS** | view: `owner_id=2e936b69405afff04cf2e12c513805678310056045c2f5f1a513bdbbd53ee552` |
| 4 | Login with **old** credentials | **FAIL** (expected) — refused / no JWT | HTTP **401**, `error_code=RODIT_NOT_FOUND` (“RODiT not found on blockchain”); UTC `2026-11-14T18:28:38.551Z` |
| 5 | Login with **new** credentials | **PASS** — JWT + 200 | UTC `2026-11-14T18:28:38.735Z`; `tokenId=cdcqsfbrsncj`; JWT `jti=jti01M7DN34WDDS7VNTFY4T7AVDA9`; `/api/me/identity` 200 |
| 6 | Transfer back | **PASS** | [nearblocks `3Dg6cGCPs3Q8MMLGMJ5ENSBf7bnrhN8Hk4SRtzKatuRz`](https://nearblocks.io/txns/3Dg6cGCPs3Q8MMLGMJ5ENSBf7bnrhN8Hk4SRtzKatuRz) · owner restored to `24c0ecfe…90c4c3c3`; post-return login JWT `jti=jti01M7DN43855ZGVR5W819SRWR2D` |

## How to re-run (judges)

1. Create/fund a disposable destination implicit account (`idcp-wallet.sh gennearaccount`, then fund ≥ ~0.025 NEAR).
2. Ensure the current owner can cover `rodit_transfer` (0.01 NEAR deposit + gas; ~0.025–0.035 NEAR balance recommended with 10–15 Tgas).
3. `NEAR_CREDENTIALS_FILE_PATH=… node examples/native-login.js` as current owner (expect PASS).
4. `rodit_transfer` via `idcp-wallet.sh <from> <to> <token_id>` (or `near contract call-function … rodit_transfer`).
5. Re-login as **old** (expect FAIL) and **new** (expect PASS).
6. Transfer back when done.

Automated C4 inside `api-test-scaffold` CI remains useful later; it is **not** required for this contest entry when this dated report stands.

## Explorer index (this run)

| Event | Tx |
|-------|-----|
| Outbound `rodit_transfer` | [`4RYaXma5qTUk5PgvfdKJBdDuEMGrEeQquBHez8dQ5G6n`](https://nearblocks.io/txns/4RYaXma5qTUk5PgvfdKJBdDuEMGrEeQquBHez8dQ5G6n) |
| Return `rodit_transfer` | [`3Dg6cGCPs3Q8MMLGMJ5ENSBf7bnrhN8Hk4SRtzKatuRz`](https://nearblocks.io/txns/3Dg6cGCPs3Q8MMLGMJ5ENSBf7bnrhN8Hk4SRtzKatuRz) |

## Scaffold suite maturity (historical deploy run)

Evidence that the IdentyClaw home API implementation is exercised continuously by `api-test-scaffold`, not only by the manual transfer pairing above.

### Latest complete deploy run

| Field | Value |
|-------|--------|
| **Window (UTC)** | 2026-11-14T11:14:42Z → 2026-11-14T11:23:54Z |
| **Host / image** | `api-test-scaffold-container` (`localhost/api-test-scaffold-app:fab2fea…`, started 2026-11-14T11:14:41Z) |
| **API under test** | `https://api.identyclaw.com` |
| **Contract / RODiT** | `genaaaa-identyclaw-com.near` / `bjsmlhbnchsw` |
| **Harness summary** | **203 passed**, 0 not-passed, 2 skipped (excluded), total 203 |
| **`allTestsSuccess`** | `True` (from log `All tests completed`) |
| **Branch profile** | **development** matrix (includes `stressTests` + `performanceSlo`) |
| **Source** | `podman logs api-test-scaffold-container` via `scripts/report-test-run.py` semantics |

A prior complete run in the same container log stream also finished with `allTestsSuccess=true` and the same **203 / 0 not-passed** summary — two consecutive green deploys retained in the local log buffer.

### Suite rollup

| Suite | Suite outcome | PASS | EXCLUDED | FAIL |
|-------|---------------|------|----------|------|
| `stressTests` | **passed** | 6 | 0 | 0 |
| `authentication` | **passed** | 5 | 0 | 0 |
| `authenticationComprehensive` | **passed** | 28 | 2 | 0 |
| `contentType` | **passed** | 1 | 0 | 0 |
| `errorHandling` | **passed** | 5 | 0 | 0 |
| `holaVerificationCoverage` | **passed** | 5 | 0 | 0 |
| `identyclawApi` | **passed** | 54 | 0 | 0 |
| `integration` | **passed** | 10 | 0 | 0 |
| `mcp` | **passed** | 6 | 0 | 0 |
| `metrics` | **passed** | 6 | 0 | 0 |
| `openapiSurface` | **passed** | 16 | 0 | 0 |
| `policyDocuments` | **passed** | 3 | 0 | 0 |
| `rateLimiting` | **passed** | 1 | 0 | 0 |
| `schemaDocumentation` | **passed** | 4 | 0 | 0 |
| `sdkInfrastructure` | **passed** | 15 | 0 | 0 |
| `security` | **passed** | 3 | 0 | 0 |
| `sessionManagement` | **passed** | 10 | 0 | 0 |
| `subagentAuthorization` | **passed** | 3 | 0 | 0 |
| `webhooks` | **passed** | 11 | 0 | 0 |
| `sessionLifetime` | **passed** | 3 | 0 | 0 |
| `performanceSlo` | **passed** | 6 | 0 | 0 |

### Full test inventory (latest run)

Status is from the latest complete deployment-time run above. `EXCLUDED` means listed in `EXCLUDED_TESTS` for this deploy (federated peer cases). HOLA proof-sheet **C4** inside `testProofSheetC2C3C4N10` is the verify-path ownership refuse; the **login/ownership transfer pairing** in this document is the separate C4 evidence for custody move.

| Suite | Test | Result |
|-------|------|--------|
| `stressTests` | `testAuthStress` | **PASS** |
| `stressTests` | `testBaselineStress` | **PASS** |
| `stressTests` | `testBurstStress` | **PASS** |
| `stressTests` | `testFailureScenarios` | **PASS** |
| `stressTests` | `testPerfJwtSteadyPoll` | **PASS** |
| `stressTests` | `testPerfLoginErrorBudget` | **PASS** |
| `authentication` | `testLoginEndpoint` | **PASS** |
| `authentication` | `testLogoutEndpoint` | **PASS** |
| `authentication` | `testMeIdentityEndpoint` | **PASS** |
| `authentication` | `testProtectedNoncetsEndpoint` | **PASS** |
| `authentication` | `testTokenRenewal` | **PASS** |
| `authenticationComprehensive` | `testConcurrentLoginRequests` | **PASS** |
| `authenticationComprehensive` | `testConcurrentLogins` | **PASS** |
| `authenticationComprehensive` | `testCrossMethodTokenUsage` | **PASS** |
| `authenticationComprehensive` | `testFederatedLoginMitmRejection` | **EXCLUDED** |
| `authenticationComprehensive` | `testFederatedLoginServerPositive` | **EXCLUDED** |
| `authenticationComprehensive` | `testLoginAccountIdInvalidSignatureReturns401` | **PASS** |
| `authenticationComprehensive` | `testLoginAmbiguousIdentifierReturns400` | **PASS** |
| `authenticationComprehensive` | `testLoginAmbiguousTimestampReturns400` | **PASS** |
| `authenticationComprehensive` | `testLoginClientPositive` | **PASS** |
| `authenticationComprehensive` | `testLoginClientWithAccountIdPositive` | **PASS** |
| `authenticationComprehensive` | `testLoginClientWithNEP413Positive` | **PASS** |
| `authenticationComprehensive` | `testLoginDeprecatedSignatureFieldReturns400` | **PASS** |
| `authenticationComprehensive` | `testLoginDuplicateSignatureFieldsReturns400` | **PASS** |
| `authenticationComprehensive` | `testLoginInternalErrorContract` | **PASS** |
| `authenticationComprehensive` | `testLoginInvalidSignatureReturns401` | **PASS** |
| `authenticationComprehensive` | `testLoginInvalidTimestampReturns400` | **PASS** |
| `authenticationComprehensive` | `testLoginMissingFieldsReturns400` | **PASS** |
| `authenticationComprehensive` | `testLoginMissingIdentifierReturns400` | **PASS** |
| `authenticationComprehensive` | `testLoginServerAccountIdOnlyPositive` | **PASS** |
| `authenticationComprehensive` | `testLoginServerExplicitAccountIdPositive` | **PASS** |
| `authenticationComprehensive` | `testLoginServerInvalidTimestamp` | **PASS** |
| `authenticationComprehensive` | `testLoginServerPositive` | **PASS** |
| `authenticationComprehensive` | `testLoginServerWithAccountIdPositive` | **PASS** |
| `authenticationComprehensive` | `testLoginSuccessfulRoundTripMatchesSwagger` | **PASS** |
| `authenticationComprehensive` | `testLoginTimestampGetMatchesSwagger` | **PASS** |
| `authenticationComprehensive` | `testLoginWrongContentTypeReturns415` | **PASS** |
| `authenticationComprehensive` | `testMissingRoditId` | **PASS** |
| `authenticationComprehensive` | `testSessionIsolation` | **PASS** |
| `authenticationComprehensive` | `testSignatureTampering` | **PASS** |
| `authenticationComprehensive` | `testTamperedSignature` | **PASS** |
| `contentType` | `testContentTypeValidation` | **PASS** |
| `errorHandling` | `testAgentManagementErrorHandling` | **PASS** |
| `errorHandling` | `testAuthenticationNegativeCases` | **PASS** |
| `errorHandling` | `testIdentityErrorHandling` | **PASS** |
| `errorHandling` | `testMetricsErrorHandling` | **PASS** |
| `errorHandling` | `testSessionManagementErrorHandling` | **PASS** |
| `holaVerificationCoverage` | `testCoverageGate` | **PASS** |
| `holaVerificationCoverage` | `testHolaVerificationCoverage` | **PASS** |
| `holaVerificationCoverage` | `testIdentityVerifyComprehensive` | **PASS** |
| `holaVerificationCoverage` | `testProofSheetC2C3C4N10` | **PASS** |
| `holaVerificationCoverage` | `testTestholaComprehensive` | **PASS** |
| `identyclawApi` | `testAgentAuthParamsGet` | **PASS** |
| `identyclawApi` | `testAgentsList` | **PASS** |
| `identyclawApi` | `testApiDiscoveryRoot` | **PASS** |
| `identyclawApi` | `testAuthenticationRequired` | **PASS** |
| `identyclawApi` | `testCharacterEncodingEdgeCases` | **PASS** |
| `identyclawApi` | `testConstraintValidationEdgeCases` | **PASS** |
| `identyclawApi` | `testDidResolutionEndpoints` | **PASS** |
| `identyclawApi` | `testDidResolutionNegativeCases` | **PASS** |
| `identyclawApi` | `testDocsEnrollmentRemoved` | **PASS** |
| `identyclawApi` | `testEnrollmentInformation` | **PASS** |
| `identyclawApi` | `testHeaderValidationEdgeCases` | **PASS** |
| `identyclawApi` | `testHealthEndpoint` | **PASS** |
| `identyclawApi` | `testHelloStringLengthLimit` | **PASS** |
| `identyclawApi` | `testHolaHandshakeValidation` | **PASS** |
| `identyclawApi` | `testHtmlDocumentation` | **PASS** |
| `identyclawApi` | `testIdentityTokenDNStructure` | **PASS** |
| `identyclawApi` | `testIdentityTokenFull` | **PASS** |
| `identyclawApi` | `testIdentityTokenFullLookup` | **PASS** |
| `identyclawApi` | `testIdentityTokenNotFound` | **PASS** |
| `identyclawApi` | `testIdentityVerify` | **PASS** |
| `identyclawApi` | `testIdentityVerifyPublicAccess` | **PASS** |
| `identyclawApi` | `testInvalidJwtTokens` | **PASS** |
| `identyclawApi` | `testIsAuthorizedSigner` | **PASS** |
| `identyclawApi` | `testMalformedJsonBody` | **PASS** |
| `identyclawApi` | `testMcpDiscoveryMetadata` | **PASS** |
| `identyclawApi` | `testMcpResourceNotFound` | **PASS** |
| `identyclawApi` | `testMcpResources` | **PASS** |
| `identyclawApi` | `testMcpSchema` | **PASS** |
| `identyclawApi` | `testMcpTransportEndpoint` | **PASS** |
| `identyclawApi` | `testMeIdentity` | **PASS** |
| `identyclawApi` | `testMetricsDebug` | **PASS** |
| `identyclawApi` | `testMetricsEndpoint` | **PASS** |
| `identyclawApi` | `testMetricsReset` | **PASS** |
| `identyclawApi` | `testMetricsSystemEndpoint` | **PASS** |
| `identyclawApi` | `testNoncetsGeneration` | **PASS** |
| `identyclawApi` | `testOpenApiSpecification` | **PASS** |
| `identyclawApi` | `testOversizedInputRejection` | **PASS** |
| `identyclawApi` | `testProtocolEdgeCases` | **PASS** |
| `identyclawApi` | `testPublicDiscoveryUnsupportedMethods` | **PASS** |
| `identyclawApi` | `testRateLimitBoundary` | **PASS** |
| `identyclawApi` | `testResponseFieldValidation` | **PASS** |
| `identyclawApi` | `testSessionListAll` | **PASS** |
| `identyclawApi` | `testSessionRevoke` | **PASS** |
| `identyclawApi` | `testSignclientValidationCases` | **PASS** |
| `identyclawApi` | `testSwaggerSchemaEndpoint` | **PASS** |
| `identyclawApi` | `testTesthola` | **PASS** |
| `identyclawApi` | `testTestholaEndpoint` | **PASS** |
| `identyclawApi` | `testTimestampEdgeCases` | **PASS** |
| `identyclawApi` | `testVerifyMissingFields` | **PASS** |
| `identyclawApi` | `testVersionedOpenApiRedirect` | **PASS** |
| `identyclawApi` | `testWellKnownDataRetention` | **PASS** |
| `identyclawApi` | `testWellKnownPrivacyPolicy` | **PASS** |
| `identyclawApi` | `testWellKnownTermsOfService` | **PASS** |
| `identyclawApi` | `testWrongContentType` | **PASS** |
| `integration` | `testDidResolveInternalErrorContract` | **PASS** |
| `integration` | `testDidResolveNegativeCases` | **PASS** |
| `integration` | `testDidRoditInternalErrorContract` | **PASS** |
| `integration` | `testDidRoditResolutionNegativeCases` | **PASS** |
| `integration` | `testDidWebJsonInternalErrorContract` | **PASS** |
| `integration` | `testDidWebJsonResolution` | **PASS** |
| `integration` | `testDidWebTokenInternalErrorContract` | **PASS** |
| `integration` | `testDidWebTokenResolution` | **PASS** |
| `integration` | `testDidWellKnownUnsupportedMethods` | **PASS** |
| `integration` | `testQueryParameterValidation` | **PASS** |
| `mcp` | `testMcpPublicApiNegativeCases` | **PASS** |
| `mcp` | `testMcpResourceRetrieval` | **PASS** |
| `mcp` | `testMcpResourceRetrievalWithSdk` | **PASS** |
| `mcp` | `testMcpResourcesListing` | **PASS** |
| `mcp` | `testMcpResourcesListingWithSdk` | **PASS** |
| `mcp` | `testMcpSchemaMcpModule` | **PASS** |
| `metrics` | `testMetricsAccuracy` | **PASS** |
| `metrics` | `testMetricsAdminEndpoints` | **PASS** |
| `metrics` | `testMetricsAuthenticationRequired` | **PASS** |
| `metrics` | `testMetricsEndpoints` | **PASS** |
| `metrics` | `testMetricsInvalidTokens` | **PASS** |
| `metrics` | `testMetricsUnauthenticatedAccess` | **PASS** |
| `openapiSurface` | `testAccessModelAuthVsAuthz` | **PASS** |
| `openapiSurface` | `testApiDocsRemoved` | **PASS** |
| `openapiSurface` | `testConciergeTrustAnchor` | **PASS** |
| `openapiSurface` | `testDemoHeadsAndProofs` | **PASS** |
| `openapiSurface` | `testDemoProofsInvalidDestinatary` | **PASS** |
| `openapiSurface` | `testDidMethodRoditDocument` | **PASS** |
| `openapiSurface` | `testDocsAndOpenApiUi` | **PASS** |
| `openapiSurface` | `testFunnelLandBeacon` | **PASS** |
| `openapiSurface` | `testHolaDropAuthAndEmptyTake` | **PASS** |
| `openapiSurface` | `testIdentityVerifyIncludeProfile` | **PASS** |
| `openapiSurface` | `testLlmsTxt` | **PASS** |
| `openapiSurface` | `testMcpJsonDiscoveryAlias` | **PASS** |
| `openapiSurface` | `testOpenApiAccessModelContract` | **PASS** |
| `openapiSurface` | `testOpenapiSurfaceUnsupportedMethods` | **PASS** |
| `openapiSurface` | `testPublicIdentityProfile` | **PASS** |
| `openapiSurface` | `testSwaggerJsonRedirect` | **PASS** |
| `policyDocuments` | `testPolicyDocumentContent` | **PASS** |
| `policyDocuments` | `testPolicyDocuments` | **PASS** |
| `policyDocuments` | `testPolicyDocumentsUnsupportedMethods` | **PASS** |
| `rateLimiting` | `testRateLimiting` | **PASS** |
| `schemaDocumentation` | `testApiV1OpenApiRedirect` | **PASS** |
| `schemaDocumentation` | `testDocsEndpoint` | **PASS** |
| `schemaDocumentation` | `testOpenApiJsonSchema` | **PASS** |
| `schemaDocumentation` | `testSwaggerJsonSchema` | **PASS** |
| `sdkInfrastructure` | `testConfigSdkExcludedVaultKeyThrows` | **PASS** |
| `sdkInfrastructure` | `testConfigSdkFallbackKeysAvailable` | **PASS** |
| `sdkInfrastructure` | `testConfigSdkGetAllMergedIncludesFallbacks` | **PASS** |
| `sdkInfrastructure` | `testFederatedLoginHelpers` | **PASS** |
| `sdkInfrastructure` | `testLoggerFacadeExposesHelpers` | **PASS** |
| `sdkInfrastructure` | `testLoggerSetLoggerSwapsImplementation` | **PASS** |
| `sdkInfrastructure` | `testPerformanceServiceRecordMetricMappings` | **PASS** |
| `sdkInfrastructure` | `testPerformanceServiceSystemMetricsCpu` | **PASS** |
| `sdkInfrastructure` | `testPerformanceServiceTraceLifecycle` | **PASS** |
| `sdkInfrastructure` | `testSdkRoditClientCreateInitializes` | **PASS** |
| `sdkInfrastructure` | `testSdkRoditClientInitialization` | **PASS** |
| `sdkInfrastructure` | `testSdkRoditClientProtocolHandling` | **PASS** |
| `sdkInfrastructure` | `testSdkSurfaceExportsPresenceAndTypes` | **PASS** |
| `sdkInfrastructure` | `testSdkSurfaceLoggerFacadeShape` | **PASS** |
| `sdkInfrastructure` | `testSdkSurfaceSingletonsMatchDeepImports` | **PASS** |
| `security` | `testRateLimitEnforcement` | **PASS** |
| `security` | `testRateLimitHeaders` | **PASS** |
| `security` | `testTamperedTokens` | **PASS** |
| `sessionManagement` | `testAdminSessionManagement` | **PASS** |
| `sessionManagement` | `testConcurrentSessions` | **PASS** |
| `sessionManagement` | `testMultipleSessionsWithSdk` | **PASS** |
| `sessionManagement` | `testSessionCleanup` | **PASS** |
| `sessionManagement` | `testSessionCookieAuthenticationRejected` | **PASS** |
| `sessionManagement` | `testSessionManagementWithSdk` | **PASS** |
| `sessionManagement` | `testSessionRevocationEnforcement` | **PASS** |
| `sessionManagement` | `testSessionsListAllMalformedBearerRejected` | **PASS** |
| `sessionManagement` | `testSessionsListAllPostRejected` | **PASS** |
| `sessionManagement` | `testSessionsListAllUnauthenticatedReturns401` | **PASS** |
| `subagentAuthorization` | `testDelegatedSignerAuthorization` | **PASS** |
| `subagentAuthorization` | `testMultipleDelegatedSigners` | **PASS** |
| `subagentAuthorization` | `testSubagentHolaVerification` | **PASS** |
| `webhooks` | `testWebhookAgentEndpoint` | **PASS** |
| `webhooks` | `testWebhookAuthentication` | **PASS** |
| `webhooks` | `testWebhookEndpointAccessibility` | **PASS** |
| `webhooks` | `testWebhookEventProcessing` | **PASS** |
| `webhooks` | `testWebhookInvalidSignature` | **PASS** |
| `webhooks` | `testWebhookReceptionAtMultipleEndpoints` | **PASS** |
| `webhooks` | `testWebhookSessionCorrelation` | **PASS** |
| `webhooks` | `testWebhookSignatureGeneration` | **PASS** |
| `webhooks` | `testWebhookSignerKeyExtraction` | **PASS** |
| `webhooks` | `testWebhookTimestampValidation` | **PASS** |
| `webhooks` | `testWebhookWakeEndpoint` | **PASS** |
| `sessionLifetime` | `testSessionLifetimeHttp` | **PASS** |
| `sessionLifetime` | `testSessionLifetimeUnit` | **PASS** |
| `sessionLifetime` | `testSessionLifetimeValidation` | **PASS** |
| `performanceSlo` | `testAutomaticTokenRenewal` | **PASS** |
| `performanceSlo` | `testPerfChainReadRatio` | **PASS** |
| `performanceSlo` | `testPerfHolanonceBurst` | **PASS** |
| `performanceSlo` | `testPerfLatencyGates` | **PASS** |
| `performanceSlo` | `testPerfRpcDegradedHealth` | **PASS** |
| `performanceSlo` | `testSessionLifetimePollUntilExpiry` | **PASS** |

### Notes on maturity / gaps

- **Green rate (this run):** 203/203 executed-or-counted cases with **0 failures**.
- **Excluded by config (development):** `testFederatedLoginServerPositive`, `testFederatedLoginMitmRejection` (peer federation — still deferred in `EXCLUDED_TESTS`).
- **Conditional skip inside PASS:** `testDelegatedSignerAuthorization` / `testSubagentHolaVerification` log that peer credentials (`NEAR_TEST_PEER_CREDENTIALS_JSON_B64`) are unset; the suite still records overall success when those branches soft-skip.
- **main vs development:** `main` also excludes entire `stressTests` and `performanceSlo` suites so load/SLO cannot block production deploy; development runs them (this report’s run includes both).
- **Manual C4 transfer (this document):** complements automated `testProofSheetC2C3C4N10` with explorer + old/new login pairing; not a substitute for the rest of the matrix.
