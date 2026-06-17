import { timingSafeEqual } from "crypto";

/**
 * Constant-time comparison of an Authorization header against the expected
 * `Bearer <key>` value. Rejects unequal-length inputs without invoking
 * `timingSafeEqual` (which throws on mismatched lengths) and avoids the
 * short-circuit timing leak of a raw `!==` comparison.
 */
export function authHeaderMatches(header: string | undefined, expected: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
