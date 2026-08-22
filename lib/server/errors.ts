import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Thrown deliberately by route handlers for expected failure cases (404, 403, etc). */
export class ApiRouteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRouteError";
    this.status = status;
  }
}

export function notFound(message = "Not found") {
  return new ApiRouteError(message, 404);
}

export function unauthorized(message = "Sign in required") {
  return new ApiRouteError(message, 401);
}

export function forbidden(message = "You don't have access to this") {
  return new ApiRouteError(message, 403);
}

export function badRequest(message = "Invalid request") {
  return new ApiRouteError(message, 400);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed UUID. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Guards a UUID path param. Without this, passing a non-UUID string
 * straight into a `.eq("id", ...)` on a uuid column makes Postgres raise a
 * cast error (22P02), which would surface to the user as an opaque 500
 * instead of an honest "not found".
 */
export function assertUuid(value: string, label = "id"): void {
  if (!isUuid(value)) throw new ApiRouteError(`Invalid ${label}`, 400);
}

/**
 * Wraps a Route Handler body so every route gets the same error contract
 * without repeating try/catch in each one. Known errors (ApiRouteError,
 * Zod validation) map to the right status code with a safe message;
 * anything unexpected is logged server-side and returned as a generic 500
 * — the raw error/stack trace is never sent to the client.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiRouteError) {
        return NextResponse.json({ message: error.message }, { status: error.status });
      }
      if (error instanceof ZodError) {
        return NextResponse.json(
          { message: "Invalid request", issues: error.issues.map((i) => i.message) },
          { status: 400 },
        );
      }
      // eslint-disable-next-line no-console
      console.error("[api]", error);
      return NextResponse.json({ message: "Something went wrong" }, { status: 500 });
    }
  };
}
