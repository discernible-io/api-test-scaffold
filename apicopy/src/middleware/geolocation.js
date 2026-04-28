const { sendError, logger } = require('@rodit/rodit-auth-be');
const { ulid } = require('ulid');

/**
 * Geolocation Access Control Middleware
 * 
 * Operates as a REST feature that respects JWT token content.
 * The allowed_iso3166list field in the JWT token determines access.
 * 
 * Country code is determined by looking up the client IP in GeoIP2-Lite database.
 * Client IP is extracted from X-Real-IP or X-Forwarded-For headers set by nginx proxy.
 */

class GeolocationService {
  constructor() {
    // GeoIP2 reader will be initialized lazily on first use
    this.geoip2Reader = null;
  }

  /**
   * Get GeoIP2 reader instance (lazy initialization)
   */
  async getGeoIP2Reader() {
    if (this.geoip2Reader) {
      return this.geoip2Reader;
    }

    try {
      const maxmind = require('maxmind');
      this.geoip2Reader = await maxmind.open(
        process.env.GEOIP2_DATABASE_PATH || '/usr/share/GeoIP/GeoLite2-Country.mmdb'
      );
      return this.geoip2Reader;
    } catch (error) {
      logger.error('Failed to initialize GeoIP2 reader', {
        component: 'GeolocationService',
        method: 'getGeoIP2Reader',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Extract client IP from request
   * Checks X-Real-IP (set by nginx) first, then X-Forwarded-For
   */
  getClientIp(req) {
    // X-Real-IP is set by nginx proxy
    if (req.headers['x-real-ip']) {
      return req.headers['x-real-ip'];
    }

    // X-Forwarded-For may contain multiple IPs, use the first one
    if (req.headers['x-forwarded-for']) {
      return req.headers['x-forwarded-for'].split(',')[0].trim();
    }

    // Fallback to req.ip
    return req.ip;
  }

  /**
   * Lookup country code from client IP using GeoIP2-Lite database
   * 
   * @returns {string|null} Country code (2-letter ISO 3166-1 alpha-2) or null if lookup fails
   */
  async getCountryCode(req, requestId) {
    try {
      const clientIp = this.getClientIp(req);

      if (!clientIp) {
        logger.warn('Could not determine client IP', {
          component: 'GeolocationService',
          method: 'getCountryCode',
          requestId
        });
        return null;
      }

      const reader = await this.getGeoIP2Reader();
      const response = reader.get(clientIp);

      if (response && response.country && response.country.iso_code) {
        const countryCode = response.country.iso_code;
        logger.debug('Country code from GeoIP2 lookup', {
          component: 'GeolocationService',
          method: 'getCountryCode',
          requestId,
          clientIp,
          countryCode
        });
        return countryCode;
      }

      logger.warn('GeoIP2 lookup returned no country', {
        component: 'GeolocationService',
        method: 'getCountryCode',
        requestId,
        clientIp
      });
      return null;
    } catch (error) {
      logger.error('GeoIP2 lookup failed', {
        component: 'GeolocationService',
        method: 'getCountryCode',
        requestId,
        error: error.message
      });
      return null;
    }
  }

}

const geolocationService = new GeolocationService();

function parseIso3166List(iso3166ListJson) {
  if (!iso3166ListJson) {
    return { allow: ['WLD'], deny: [] };
  }

  try {
    const parsed = typeof iso3166ListJson === 'string' 
      ? JSON.parse(iso3166ListJson) 
      : iso3166ListJson;

    if (parsed.allow && Array.isArray(parsed.allow)) {
      const wldIndex = parsed.allow.indexOf('WLD');
      
      if (wldIndex === -1) {
        return { allow: parsed.allow, deny: [] };
      }

      const allowList = parsed.allow.slice(0, wldIndex);
      const denyList = parsed.allow.slice(wldIndex + 1);

      return { allow: allowList, deny: denyList };
    }

    return { allow: ['WLD'], deny: [] };
  } catch (error) {
    logger.warn('Failed to parse allowed_iso3166list, defaulting to WLD', {
      component: 'GeolocationMiddleware',
      method: 'parseIso3166List',
      error: error.message
    });
    return { allow: ['WLD'], deny: [] };
  }
}

function isCountryAllowed(countryCode, iso3166Config) {
  const { allow, deny } = iso3166Config;

  if (deny.includes(countryCode)) {
    return false;
  }

  if (allow.length === 0 || allow.includes('WLD')) {
    return true;
  }

  return allow.includes(countryCode);
}

async function checkGeolocation(req, res, next) {
  const requestId = req.requestId || ulid();

  // Geolocation is a REST feature - respect what the JWT token contains
  if (!req.user || !req.user.permissions) {
    logger.debug('No user/permissions in request, skipping geolocation check', {
      component: 'GeolocationMiddleware',
      method: 'checkGeolocation',
      requestId
    });
    return next();
  }

  const allowedIso3166List = req.user.permissions.allowedIso3166List;
  
  if (!allowedIso3166List) {
    logger.debug('No geolocation restrictions in JWT token', {
      component: 'GeolocationMiddleware',
      method: 'checkGeolocation',
      requestId
    });
    return next();
  }

  const iso3166Config = parseIso3166List(allowedIso3166List);

  // If only WLD with no deny list, allow all countries
  if (iso3166Config.allow.includes('WLD') && iso3166Config.deny.length === 0) {
    logger.debug('JWT token allows worldwide access', {
      component: 'GeolocationMiddleware',
      method: 'checkGeolocation',
      requestId
    });
    return next();
  }

  // Get country code from GeoIP2 lookup
  const countryCode = await geolocationService.getCountryCode(req, requestId);

  // If country code lookup failed, allow access and log the failure
  if (!countryCode) {
    logger.warn('Geolocation lookup failed, allowing access', {
      component: 'GeolocationMiddleware',
      method: 'checkGeolocation',
      requestId,
      reason: 'GeoIP2 database lookup returned no country code'
    });
    return next();
  }

  // Check if country is allowed based on JWT token restrictions
  const allowed = isCountryAllowed(countryCode, iso3166Config);

  if (!allowed) {
    // Log successful denial
    logger.warn('Geolocation check denied access', {
      component: 'GeolocationMiddleware',
      method: 'checkGeolocation',
      requestId,
      countryCode,
      allowList: iso3166Config.allow,
      denyList: iso3166Config.deny,
      reason: iso3166Config.deny.includes(countryCode) 
        ? 'Country is in deny list' 
        : 'Country not in allow list'
    });
    return sendError(res, {
      statusCode: 403,
      code: 'GEOLOCATION_FORBIDDEN',
      message: 'Access denied based on geographic location',
      details: {
        countryCode,
        reason: iso3166Config.deny.includes(countryCode) 
          ? 'Country is in deny list' 
          : 'Country not in allow list'
      }
    });
  }

  // Log successful check (allowed)
  logger.debug('Geolocation check allowed access', {
    component: 'GeolocationMiddleware',
    method: 'checkGeolocation',
    requestId,
    countryCode,
    allowList: iso3166Config.allow,
    denyList: iso3166Config.deny
  });

  // Attach geolocation info to request for downstream handlers
  req.geoLocation = {
    countryCode,
    allowed: true
  };

  next();
}

module.exports = {
  checkGeolocation,
  parseIso3166List,
  isCountryAllowed,
  geolocationService
};
