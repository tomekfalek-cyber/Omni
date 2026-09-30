import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

export class RateLimiter {
  /**
   * Global rate limiter dla wszystkich endpointów.
   */
  public static globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minut
    max: 1000, // 1000 requestów na 15 minut
    message: {
      error: 'Too many requests, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      return String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
    }
  });

  /**
   * Rate limiter dla endpointów LLM (bardziej restrykcyjny).
   */
  public static llmLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuta
    max: 30, // 30 requestów na minutę
    message: {
      error: 'LLM rate limit exceeded. Please slow down.',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = req.headers['x-user-id'] || req.ip;
      return `llm:${userId}`;
    }
  });

  /**
   * Rate limiter dla narzędzi (per user + tool).
   */
  public static toolLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuta
    max: 50, // 50 wywołań narzędzi na minutę
    message: {
      error: 'Tool rate limit exceeded.',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = req.headers['x-user-id'] || req.ip;
      const toolName = req.body?.toolName || 'unknown';
      return `tool:${userId}:${toolName}`;
    }
  });

  /**
   * Rate limiter dla WebSocket connections.
   */
  public static websocketLimiter = new Map<string, { count: number; resetTime: number }>();

  public static checkWebSocketLimit(userId: string): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minuta
    const maxConnections = 5; // 5 połączeń na minutę

    const record = this.websocketLimiter.get(userId);
    
    if (!record || now > record.resetTime) {
      this.websocketLimiter.set(userId, {
        count: 1,
        resetTime: now + windowMs
      });
      return true;
    }

    if (record.count >= maxConnections) {
      return false;
    }

    record.count++;
    return true;
  }

  /**
   * Czyści stare rekordy (wywoływane okresowo).
   */
  public static cleanupWebSocketLimits(): void {
    const now = Date.now();
    for (const [userId, record] of this.websocketLimiter) {
      if (now > record.resetTime) {
        this.websocketLimiter.delete(userId);
      }
    }
  }
}

// Czyszczenie co minutę
setInterval(() => {
  RateLimiter.cleanupWebSocketLimits();
}, 60 * 1000);
