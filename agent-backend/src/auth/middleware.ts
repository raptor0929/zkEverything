import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  userId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.slice(7);
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET env var not set");

  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    (req as AuthenticatedRequest).userId = payload.sub as string;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
