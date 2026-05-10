import { requireAuth, AuthenticatedRequest } from "./middleware";
import { Request, Response, NextFunction } from "express";

// Mock the Supabase admin client so tests don't need real credentials.
jest.mock("../agent/supabase", () => ({
  getSupabaseAdmin: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getSupabaseAdmin } = require("../agent/supabase") as {
  getSupabaseAdmin: jest.Mock;
};

const mockGetUser = jest.fn();

beforeEach(() => {
  mockGetUser.mockReset();
  getSupabaseAdmin.mockReturnValue({ auth: { getUser: mockGetUser } });
});

function makeReq(authorization?: string): Request {
  return { headers: { authorization } } as unknown as Request;
}

function makeRes(): { res: Response; statusCode: () => number } {
  let _status = 200;
  const res = {
    status(code: number) { _status = code; return res; },
    json() { return res; },
  } as unknown as Response;
  return { res, statusCode: () => _status };
}

describe("requireAuth middleware", () => {
  it("calls next() and sets userId when Supabase returns a valid user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-abc-123" } }, error: null });
    const req = makeReq("Bearer valid.token.here");
    const { res } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as unknown as AuthenticatedRequest).userId).toBe("user-abc-123");
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = makeReq();
    const { res, statusCode } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusCode()).toBe(401);
  });

  it("returns 401 when Supabase rejects the token", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid JWT" },
    });
    const req = makeReq("Bearer bad.token.here");
    const { res, statusCode } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusCode()).toBe(401);
  });

  it("returns 401 when Supabase returns no user and no error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const req = makeReq("Bearer expired.token.here");
    const { res, statusCode } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusCode()).toBe(401);
  });
});
