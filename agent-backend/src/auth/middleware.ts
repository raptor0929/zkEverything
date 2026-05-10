import { Request, Response, NextFunction } from "express";
import { getSupabaseAdmin } from "../agent/supabase";

export interface AuthenticatedRequest extends Request {
  userId: string;
}

// Verifies the Supabase access_token via the admin client — no local JWT
// secret needed, no format ambiguity. Works with any Supabase project.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.slice(7);

  try {
    const supabase = getSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    (req as AuthenticatedRequest).userId = user.id;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
