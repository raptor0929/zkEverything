import jwt from "jsonwebtoken";
import { requireAuth, AuthenticatedRequest } from "./middleware";
import { Request, Response, NextFunction } from "express";

const TEST_SECRET = "test-jwt-secret-for-unit-tests";

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
});

function makeReq(authorization?: string): Request {
  return { headers: { authorization } } as unknown as Request;
}

function makeRes(): { res: Response; statusCode: () => number; body: () => unknown } {
  let _status = 200;
  let _body: unknown = null;
  const res = {
    status(code: number) {
      _status = code;
      return res;
    },
    json(b: unknown) {
      _body = b;
      return res;
    },
  } as unknown as Response;
  return { res, statusCode: () => _status, body: () => _body };
}

describe("requireAuth middleware", () => {
  it("calls next() and sets userId for a valid JWT", () => {
    const token = jwt.sign({ sub: "user-abc-123" }, TEST_SECRET);
    const req = makeReq(`Bearer ${token}`);
    const { res } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as unknown as AuthenticatedRequest).userId).toBe("user-abc-123");
  });

  it("returns 401 when Authorization header is missing", () => {
    const req = makeReq();
    const { res, statusCode } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusCode()).toBe(401);
  });

  it("returns 401 when token is invalid", () => {
    const req = makeReq("Bearer not.a.valid.jwt");
    const { res, statusCode } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusCode()).toBe(401);
  });

  it("returns 401 when token is signed with wrong secret", () => {
    const token = jwt.sign({ sub: "user-abc-123" }, "wrong-secret");
    const req = makeReq(`Bearer ${token}`);
    const { res, statusCode } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusCode()).toBe(401);
  });
});
