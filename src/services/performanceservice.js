/**
 * Performance monitoring service for tracing and metrics collection
 * Copyright (c) 2024 Ayayai, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const logger = require('../../config/logger');
const os = require('os');

// Load level constants
const LOAD_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// Load thresholds (requests per minute)
const LOAD_THRESHOLDS = {
  MEDIUM: 500,   // >500 req/min = medium load
  HIGH: 1000,    // >1000 req/min = high load
  CRITICAL: 2000 // >2000 req/min = critical load
};

class PerformanceService {
  constructor() {
    this.traces = new Map();
    this.metrics = {
      requestCount: 0,
      errorCount: 0,
      totalDuration: 0,
      maxDuration: 0,
      minDuration: Number.MAX_SAFE_INTEGER,
      blockchainCalls: 0,
      blockchainDuration: 0,
      authenticationCalls: 0,
      authenticationDuration: 0
    };
    this.currentLoadLevel = LOAD_LEVELS.LOW;
    this.requestsPerMinute = 0;
    this.lastMinuteTimestamp = Date.now();
    this.requestsThisMinute = 0;
  }

  /**
   * Initialize the performance monitoring service
   * 
   * @param {Object} options - Initialization options
   */
  initialize(options = {}) {
    logger.info('Performance monitoring service initialized', {
      component: 'PerformanceService',
      method: 'initialize',
      options
    });

    // Start monitoring system load
    this._startLoadMonitoring();

    return this;
  }

  /**
   * Start monitoring system load
   * 
   * @private
   */
  _startLoadMonitoring() {
    // Update load level every minute
    setInterval(() => this._updateLoadLevel(), 60000);

    logger.info('Load monitoring started', {
      component: 'PerformanceService',
      method: '_startLoadMonitoring',
      initialLoadLevel: this.currentLoadLevel
    });
  }

  /**
   * Update the current load level based on recent request rate
   * 
   * @private
   */
  _updateLoadLevel() {
    const now = Date.now();
    const elapsedMs = now - this.lastMinuteTimestamp;
    
    if (elapsedMs >= 60000) {
      // Calculate requests per minute
      this.requestsPerMinute = Math.round(this.requestsThisMinute * (60000 / elapsedMs));
      
      // Determine load level based on request rate
      let newLoadLevel;
      if (this.requestsPerMinute > LOAD_THRESHOLDS.CRITICAL) {
        newLoadLevel = LOAD_LEVELS.CRITICAL;
      } else if (this.requestsPerMinute > LOAD_THRESHOLDS.HIGH) {
        newLoadLevel = LOAD_LEVELS.HIGH;
      } else if (this.requestsPerMinute > LOAD_THRESHOLDS.MEDIUM) {
        newLoadLevel = LOAD_LEVELS.MEDIUM;
      } else {
        newLoadLevel = LOAD_LEVELS.LOW;
      }
      
      // Log if load level changed
      if (newLoadLevel !== this.currentLoadLevel) {
        logger.info('System load level changed', {
          component: 'PerformanceService',
          method: '_updateLoadLevel',
          previousLevel: this.currentLoadLevel,
          newLevel: newLoadLevel,
          requestsPerMinute: this.requestsPerMinute
        });
      }
      
      // Update state
      this.currentLoadLevel = newLoadLevel;
      this.lastMinuteTimestamp = now;
      this.requestsThisMinute = 0;
    }
  }

  /**
   * Record a new request for load monitoring
   * 
   * @param {Object} req - Express request object
   */
  recordRequest(req) {
    // Increment request counter for load monitoring
    this.requestsThisMinute++;
    
    // Update total request count metric
    this.metrics.requestCount++;
    
    // Only log in verbose mode to avoid excessive logging during high load
    if (this.shouldUseVerboseLogging()) {
      logger.debug('Request recorded for load monitoring', {
        component: 'PerformanceService',
        method: 'recordRequest',
        path: req.path,
        method: req.method,
        requestsThisMinute: this.requestsThisMinute,
        currentLoadLevel: this.currentLoadLevel
      });
    }
  }

  /**
   * Record a metric
   * 
   * @param {string} metricName - Name of the metric
   * @param {number} value - Value to record
   * @param {Object} tags - Additional tags for the metric
   */
  recordMetric(metricName, value, tags = {}) {
    // Update internal metrics
    switch(metricName) {
      case 'request_count':
        this.metrics.requestCount += value;
        // Also update the request counter for load monitoring
        this.requestsThisMinute += value;
        break;
      case 'error_count':
        this.metrics.errorCount += value;
        break;
      case 'authentication_duration':
        this.metrics.authenticationCalls++;
        this.metrics.authenticationDuration += value;
        break;
      case 'blockchain_duration':
        this.metrics.blockchainCalls++;
        this.metrics.blockchainDuration += value;
        break;
      case 'authentication_error':
      case 'blockchain_error':
        this.metrics.errorCount += value;
        break;
      default:
        // For other metrics, just log them if in verbose mode
        if (this.shouldUseVerboseLogging()) {
          logger.debug('Custom metric recorded', {
            component: 'PerformanceService',
            method: 'recordMetric',
            metricName,
            value,
            tags
          });
        }
        break;
    }
  }

  /**
   * Start a trace for performance monitoring
   * 
   * @param {string} operationName - Name of the operation being traced
   * @param {Object} metadata - Additional metadata for the trace
   * @returns {string} Trace ID
   */
  startTrace(operationName, metadata = {}) {
    const traceId = metadata.traceId || ulid();
    
    this.traces.set(traceId, {
      id: traceId,
      operationName,
      startTime: Date.now(),
      metadata: { ...metadata },
      spans: [],
      completed: false
    });
    
    // Only log in low load conditions
    if (this.currentLoadLevel === LOAD_LEVELS.LOW) {
      logger.debug('Trace started', {
        component: 'PerformanceService',
        method: 'startTrace',
        traceId,
        operationName
      });
    }
    
    return traceId;
  }

  /**
   * Add a span to an existing trace
   * 
   * @param {string} traceId - ID of the parent trace
   * @param {string} spanName - Name of the span
   * @param {Object} metadata - Additional metadata for the span
   * @returns {Object} Span object with stop function
   */
  startSpan(traceId, spanName, metadata = {}) {
    const trace = this.traces.get(traceId);
    
    if (!trace) {
      logger.warn('Attempted to add span to non-existent trace', {
        component: 'PerformanceService',
        method: 'startSpan',
        traceId,
        spanName
      });
      
      return {
        id: ulid(),
        stop: () => {}
      };
    }
    
    const spanId = ulid();
    const span = {
      id: spanId,
      name: spanName,
      startTime: Date.now(),
      metadata: { ...metadata },
      parentId: traceId
    };
    
    trace.spans.push(span);
    
    // Only log in low load conditions
    if (this.currentLoadLevel === LOAD_LEVELS.LOW) {
      logger.debug('Span started', {
        component: 'PerformanceService',
        method: 'startSpan',
        traceId,
        spanId,
        spanName
      });
    }
    
    return {
      id: spanId,
      stop: () => this.stopSpan(traceId, spanId)
    };
  }

  /**
   * Stop a span and record its duration
   * 
   * @param {string} traceId - ID of the parent trace
   * @param {string} spanId - ID of the span to stop
   */
  stopSpan(traceId, spanId) {
    const trace = this.traces.get(traceId);
    
    if (!trace) {
      return;
    }
    
    const span = trace.spans.find(s => s.id === spanId);
    
    if (!span) {
      return;
    }
    
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    
    // Track specific metrics based on span type
    if (span.name.includes('blockchain')) {
      this.metrics.blockchainCalls++;
      this.metrics.blockchainDuration += span.duration;
    } else if (span.name.includes('auth')) {
      this.metrics.authenticationCalls++;
      this.metrics.authenticationDuration += span.duration;
    }
    
    // Only log in low load conditions
    if (this.currentLoadLevel === LOAD_LEVELS.LOW) {
      const logLevel = this._getDurationLogLevel(span.duration);
      
      logger[logLevel]('Span completed', {
        component: 'PerformanceService',
        method: 'stopSpan',
        traceId,
        spanId,
        spanName: span.name,
        duration: span.duration
      });
    }
  }

  /**
   * Complete a trace and record its metrics
   * 
   * @param {string} traceId - ID of the trace to complete
   * @param {Object} result - Result of the operation
   * @returns {Object} Completed trace with metrics
   */
  completeTrace(traceId, result = {}) {
    const trace = this.traces.get(traceId);
    
    if (!trace) {
      logger.warn('Attempted to complete non-existent trace', {
        component: 'PerformanceService',
        method: 'completeTrace',
        traceId
      });
      
      return null;
    }
    
    if (trace.completed) {
      return trace;
    }
    
    trace.endTime = Date.now();
    trace.duration = trace.endTime - trace.startTime;
    trace.result = result;
    trace.completed = true;
    
    // Update overall metrics
    this.metrics.totalDuration += trace.duration;
    this.metrics.maxDuration = Math.max(this.metrics.maxDuration, trace.duration);
    this.metrics.minDuration = Math.min(this.metrics.minDuration, trace.duration);
    
    // Only log in non-high load conditions or if there's an error
    if (this.shouldUseVerboseLogging() || result.error) {
      const logLevel = result.error ? 'warn' : this._getDurationLogLevel(trace.duration);
      
      logger[logLevel]('Trace completed', {
        component: 'PerformanceService',
        method: 'completeTrace',
        traceId,
        operationName: trace.operationName,
        duration: trace.duration,
        spanCount: trace.spans.length,
        hasError: !!result.error,
        errorMessage: result.error
      });
    }
    
    return trace;
  }

  /**
   * End a trace (alias for completeTrace)
   * 
   * @param {string} traceId - ID of the trace to end
   * @param {Object} result - Result of the operation
   * @returns {Object} Completed trace with metrics
   */
  endTrace(traceId, result = {}) {
    return this.completeTrace(traceId, result);
  }

  /**
   * Get a trace by ID
   * 
   * @param {string} traceId - ID of the trace to retrieve
   * @returns {Object} Trace object
   */
  getTrace(traceId) {
    return this.traces.get(traceId);
  }

  /**
   * Get current performance metrics
   * 
   * @returns {Object} Current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      currentLoadLevel: this.currentLoadLevel,
      requestsPerMinute: this.requestsPerMinute
    };
  }

  /**
   * Reset performance metrics
   */
  resetMetrics() {
    this.metrics = {
      requestCount: 0,
      errorCount: 0,
      totalDuration: 0,
      maxDuration: 0,
      minDuration: Number.MAX_SAFE_INTEGER,
      blockchainCalls: 0,
      blockchainDuration: 0,
      authenticationCalls: 0,
      authenticationDuration: 0
    };
    
    logger.info('Performance metrics reset', {
      component: 'PerformanceService',
      method: 'resetMetrics'
    });
  }

  /**
   * Get appropriate log level based on duration
   * @private
   * 
   * @param {number} duration - Operation duration in ms
   * @returns {string} Log level to use
   */
  _getDurationLogLevel(duration) {
    if (duration > 1000) {
      return 'warn'; // Over 1 second
    } else if (duration > 500) {
      return 'info'; // 500ms - 1 second
    } else {
      return 'debug'; // Under 500ms
    }
  }

  /**
   * Check if verbose logging should be used based on current load
   * 
   * @returns {boolean} Whether to use verbose logging
   */
  shouldUseVerboseLogging() {
    // Only use verbose logging in low and medium load conditions
    return this.currentLoadLevel === LOAD_LEVELS.LOW || 
           this.currentLoadLevel === LOAD_LEVELS.MEDIUM;
  }

  /**
   * Get system resource usage metrics
   * 
   * @returns {Object} System resource metrics
   */
  getSystemMetrics() {
    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    
    return {
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        loadAvg: os.loadavg()
      },
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers
      },
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }
}

// Create and export singleton instance
const performanceService = new PerformanceService();
module.exports = performanceService;
