import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'anagu-dev-session-signing-key-2026-change-in-prod';

export type UserRole = 'citizen' | 'surveyor' | 'registrar' | 'land_admin' | 'governor' | 'sys_admin';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  walletAddress: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      walletAddress: user.walletAddress,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function verifyToken(token: string): AuthUser {
  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
  return {
    id: String(decoded.sub),
    email: String(decoded.email),
    role: decoded.role as UserRole,
    fullName: String(decoded.fullName),
    walletAddress: String(decoded.walletAddress),
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const rawToken = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;

  if (!rawToken) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  try {
    const tokenUser = verifyToken(rawToken);
    const dbUser = db
      .prepare('SELECT id, full_name, email, role_code, wallet_address, is_active FROM users WHERE id = ?')
      .get(tokenUser.id) as
      | { id: string; full_name: string; email: string; role_code: UserRole; wallet_address: string; is_active: number }
      | undefined;

    if (!dbUser || !dbUser.is_active) {
      res.status(401).json({ error: 'Account is inactive or not found.' });
      return;
    }

    req.user = {
      id: dbUser.id,
      fullName: dbUser.full_name,
      email: dbUser.email,
      role: dbUser.role_code,
      walletAddress: dbUser.wallet_address,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token.' });
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      db.prepare(`
        INSERT INTO audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        req.user.id,
        req.user.role,
        'UNAUTHORIZED_ACCESS_BLOCKED',
        'endpoint',
        req.originalUrl,
        JSON.stringify({ requiredRoles: allowedRoles, actualRole: req.user.role }),
        req.ip || '127.0.0.1',
        new Date().toISOString()
      );

      res.status(403).json({
        error: `Access denied. Role '${req.user.role}' is not authorised for this action. Required: ${allowedRoles.join(', ')}.`,
      });
      return;
    }
    next();
  };
}

// Simple in-memory rate limiter for auth & mutation endpoints
const requestHits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests = 120, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path.startsWith('/api/auth') ? 'auth' : 'api'}`;
    const now = Date.now();
    const record = requestHits.get(key);

    if (!record || now > record.resetAt) {
      requestHits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    record.count += 1;
    if (record.count > maxRequests) {
      res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
      return;
    }
    next();
  };
}
