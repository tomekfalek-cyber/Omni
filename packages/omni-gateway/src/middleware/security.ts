import helmet from 'helmet';
import { Request, Response, NextFunction } from 'express';
import { getAuditLogger } from '../security/audit-logger.js';

/**
 * Middleware do logowania wszystkich requestów.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const audit = getAuditLogger();
    
    audit.log({
      userId: (req.headers['x-user-id'] as string) || 'anonymous',
      action: `${req.method} ${req.path}`,
      resource: req.path,
      details: {
        method: req.method,
        statusCode: res.statusCode,
        duration,
        userAgent: req.headers['user-agent']
      },
      success: res.statusCode < 400,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(err => console.error('[RequestLogger] Błąd logowania:', err));
  });

  next();
}

/**
 * Middleware do walidacji CORS.
 */
export function corsValidator(req: Request, res: Response, next: NextFunction): void {
  const allowedOrigins = (process.env.OMNI_ALLOWED_ORIGINS || '*').split(',');
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-ID');
  res.header('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
}

/**
 * Middleware do walidacji Content-Type.
 */
export function contentTypeValidator(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'POST' || req.method === 'PUT') {
    const contentType = req.headers['content-type'];
    
    if (!contentType || !contentType.includes('application/json')) {
      res.status(415).json({
        error: 'Unsupported Media Type',
        message: 'Content-Type must be application/json'
      });
      return;
    }
  }

  next();
}

/**
 * Middleware do wykrywania suspicious requests.
 */
export function suspiciousRequestDetector(req: Request, res: Response, next: NextFunction): void {
  const suspiciousPatterns = [
    /(\.\.\/|\.\.\\)/, // Path traversal
    /(select|insert|update|delete|drop|union).*from/i, // SQL injection
    /<script.*>.*<\/script>/i, // XSS
    /eval\(|exec\(|system\(/i, // Code injection
  ];

  const requestString = JSON.stringify({
    url: req.url,
    query: req.query,
    body: req.body
  });

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestString)) {
      const audit = getAuditLogger();
      audit.log({
        userId: (req.headers['x-user-id'] as string) || 'anonymous',
        action: 'SUSPICIOUS_REQUEST',
        resource: req.path,
        details: {
          pattern: pattern.toString(),
          request: requestString.substring(0, 500)
        },
        success: false,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }).catch(err => console.error('[SuspiciousDetector] Błąd logowania:', err));

      res.status(400).json({
        error: 'Bad Request',
        message: 'Suspicious request detected'
      });
      return;
    }
  }

  next();
}

/**
 * Konfiguracja Helmet dla bezpieczeństwa HTTP headers.
 */
export function configureHelmet() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    dnsPrefetchControl: true,
    frameguard: { action: "deny" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    ieNoOpen: true,
    noSniff: true,
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xssFilter: true
  });
}
