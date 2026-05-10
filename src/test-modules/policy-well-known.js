/**
 * Policy and Well-Known Endpoints Tests
 * 
 * Tests for policy documents and well-known endpoints that provide
 * legal, informational, and DID resolution information.
 */

const { logger } = require('../../sdk');
const { ulid } = require('ulid');
const { fetchDirect } = require('./test-utils');

const policyWellKnownTests = {
  /**
   * Test GET /.well-known/terms-of-service
   * Verifies terms of service document is available
   */
  testTermsOfService: async (api_ep) => {
    const moduleName = 'policy-well-known';
    const testName = 'testTermsOfService';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/terms-of-service` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/.well-known/terms-of-service', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasContent = !!data.content || !!data.html || !!data.text;
      testData.hasVersion = !!data.version;
      testData.hasLastUpdated = !!data.lastUpdated || !!data.updated_at;

      if (!testData.hasContent) {
        throw new Error('Terms of service document missing content');
      }

      return {
        passed: true,
        message: 'Terms of service document is available',
        details: {
          hasContent: testData.hasContent,
          hasVersion: testData.hasVersion,
          hasLastUpdated: testData.hasLastUpdated
        }
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message
      });

      return {
        passed: false,
        error: error.message,
        testData
      };
    }
  },

  /**
   * Test GET /.well-known/privacy-policy
   * Verifies privacy policy document is available
   */
  testPrivacyPolicy: async (api_ep) => {
    const moduleName = 'policy-well-known';
    const testName = 'testPrivacyPolicy';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/privacy-policy` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/.well-known/privacy-policy', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasContent = !!data.content || !!data.html || !!data.text;
      testData.hasVersion = !!data.version;
      testData.hasLastUpdated = !!data.lastUpdated || !!data.updated_at;

      if (!testData.hasContent) {
        throw new Error('Privacy policy document missing content');
      }

      return {
        passed: true,
        message: 'Privacy policy document is available',
        details: {
          hasContent: testData.hasContent,
          hasVersion: testData.hasVersion,
          hasLastUpdated: testData.hasLastUpdated
        }
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message
      });

      return {
        passed: false,
        error: error.message,
        testData
      };
    }
  },

  /**
   * Test GET /.well-known/data-retention
   * Verifies data retention policy is available
   */
  testDataRetention: async (api_ep) => {
    const moduleName = 'policy-well-known';
    const testName = 'testDataRetention';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/data-retention` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/.well-known/data-retention', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasContent = !!data.content || !!data.html || !!data.text;
      testData.hasRetentionPeriods = !!data.retentionPeriods || !!data.retention_periods;

      if (!testData.hasContent) {
        throw new Error('Data retention policy missing content');
      }

      return {
        passed: true,
        message: 'Data retention policy is available',
        details: {
          hasContent: testData.hasContent,
          hasRetentionPeriods: testData.hasRetentionPeriods
        }
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message
      });

      return {
        passed: false,
        error: error.message,
        testData
      };
    }
  },

  /**
   * Test GET /.well-known/why-identyclaw
   * Verifies value proposition document is available
   */
  testWhyIdentyClaw: async (api_ep) => {
    const moduleName = 'policy-well-known';
    const testName = 'testWhyIdentyClaw';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/why-identyclaw` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/.well-known/why-identyclaw', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasContent = !!data.content || !!data.html || !!data.text;
      testData.hasFeatures = !!data.features || !!data.benefits;

      if (!testData.hasContent) {
        throw new Error('Why IdentyClaw document missing content');
      }

      return {
        passed: true,
        message: 'Why IdentyClaw value proposition is available',
        details: {
          hasContent: testData.hasContent,
          hasFeatures: testData.hasFeatures
        }
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message
      });

      return {
        passed: false,
        error: error.message,
        testData
      };
    }
  },

  /**
   * Test GET /.well-known/did/rodit/{tokenId}
   * Verifies did:rodit DID document resolution
   */
  testDidRoditResolution: async (api_ep) => {
    const moduleName = 'policy-well-known';
    const testName = 'testDidRoditResolution';
    const correlationId = ulid();
    const testTokenId = 'abcdefghijkl'; // Valid format: 12 lowercase letters
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/did/rodit/{tokenId}`, tokenId: testTokenId };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, `/.well-known/did/rodit/${testTokenId}`, {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      // May return 404 if token doesn't exist, which is valid
      if (response.status === 404) {
        testData.notFound = true;
        return {
          passed: true,
          message: 'DID resolution endpoint responds correctly (token not found)',
          details: {
            status: 404,
            endpointAccessible: true
          }
        };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200 or 404, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasId = !!data.id;
      testData.hasContext = !!data['@context'];
      testData.hasController = !!data.controller;
      testData.hasVerificationMethod = !!data.verificationMethod;

      if (!testData.hasId) {
        throw new Error('DID document missing id field');
      }

      return {
        passed: true,
        message: 'DID rodit resolution endpoint returns valid DID document',
        details: {
          hasId: testData.hasId,
          hasContext: testData.hasContext,
          hasController: testData.hasController,
          hasVerificationMethod: testData.hasVerificationMethod
        }
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message
      });

      return {
        passed: false,
        error: error.message,
        testData
      };
    }
  },

  /**
   * Test GET /.well-known/did/web/token/{tokenId}
   * Verifies did:web DID document resolution
   */
  testDidWebTokenResolution: async (api_ep) => {
    const moduleName = 'policy-well-known';
    const testName = 'testDidWebTokenResolution';
    const correlationId = ulid();
    const testTokenId = 'abcdefghijkl'; // Valid format: 12 lowercase letters
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/did/web/token/{tokenId}`, tokenId: testTokenId };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, `/.well-known/did/web/token/${testTokenId}`, {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      // May return 404 if token doesn't exist, which is valid
      if (response.status === 404) {
        testData.notFound = true;
        return {
          passed: true,
          message: 'DID web resolution endpoint responds correctly (token not found)',
          details: {
            status: 404,
            endpointAccessible: true
          }
        };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200 or 404, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasId = !!data.id;
      testData.hasContext = !!data['@context'];
      testData.hasController = !!data.controller;

      if (!testData.hasId) {
        throw new Error('DID document missing id field');
      }

      return {
        passed: true,
        message: 'DID web resolution endpoint returns valid DID document',
        details: {
          hasId: testData.hasId,
          hasContext: testData.hasContext,
          hasController: testData.hasController
        }
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message
      });

      return {
        passed: false,
        error: error.message,
        testData
      };
    }
  },

  /**
   * Test GET /.well-known/did/web/token/{tokenId}/did.json
   * Verifies did:web JSON DID document resolution
   */
  testDidWebTokenJsonResolution: async (api_ep) => {
    const moduleName = 'policy-well-known';
    const testName = 'testDidWebTokenJsonResolution';
    const correlationId = ulid();
    const testTokenId = 'abcdefghijkl'; // Valid format: 12 lowercase letters
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/did/web/token/{tokenId}/did.json`, tokenId: testTokenId };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, `/.well-known/did/web/token/${testTokenId}/did.json`, {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      // May return 404 if token doesn't exist, which is valid
      if (response.status === 404) {
        testData.notFound = true;
        return {
          passed: true,
          message: 'DID web JSON resolution endpoint responds correctly (token not found)',
          details: {
            status: 404,
            endpointAccessible: true
          }
        };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200 or 404, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasId = !!data.id;
      testData.hasContext = !!data['@context'];
      testData.hasVerificationMethod = !!data.verificationMethod;

      if (!testData.hasId) {
        throw new Error('DID document missing id field');
      }

      return {
        passed: true,
        message: 'DID web JSON resolution endpoint returns valid DID document',
        details: {
          hasId: testData.hasId,
          hasContext: testData.hasContext,
          hasVerificationMethod: testData.hasVerificationMethod
        }
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message
      });

      return {
        passed: false,
        error: error.message,
        testData
      };
    }
  }
};

module.exports = policyWellKnownTests;
