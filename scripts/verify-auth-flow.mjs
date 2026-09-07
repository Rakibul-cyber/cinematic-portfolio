/**
 * End-to-end verification of the Phase 2 authentication foundation.
 *
 * This deliberately uses only Node's built-in fetch; no testing framework is
 * introduced for Phase 2. It exercises the real HTTP surface of a running
 * application, which is the only way to prove that route protection, cookie
 * handling, and database-backed session invalidation work together.
 *
 * Usage:
 *
 *   npm run build
 *   npx next start          (in another terminal)
 *   ADMIN_TEST_EMAIL=... ADMIN_TEST_PASSWORD=... npm run auth:verify
 *
 * Credentials come from the environment and are never printed. The account must
 * already exist; create it with `npm run admin:bootstrap`.
 */
const baseUrl = (
  process.env.AUTH_VERIFY_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
const email = process.env.ADMIN_TEST_EMAIL;
const password = process.env.ADMIN_TEST_PASSWORD;

if (!email || !password) {
  console.error("ADMIN_TEST_EMAIL and ADMIN_TEST_PASSWORD must be set.");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/**
 * Requests without following redirects, so the redirect itself can be asserted.
 *
 * An `Origin` header is always sent because Better Auth rejects state-changing
 * requests from an untrusted or absent origin. A browser always supplies it;
 * omitting it here would test the origin guard instead of the credentials.
 */
function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...init,
    headers: { origin: baseUrl, ...(init.headers ?? {}) },
  });
}

function sessionCookieFrom(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const cookie = raw.find((value) => value.includes("session_token="));
  return cookie ? cookie.split(";")[0] : null;
}

function isRedirect(response) {
  return response.status >= 300 && response.status < 400;
}

console.log(`\nVerifying admin authentication at ${baseUrl}\n`);

// 1. Unauthenticated access to a protected route is refused.
{
  const response = await request("/admin");
  const location = response.headers.get("location") ?? "";
  check(
    "unauthenticated /admin redirects to the login page",
    isRedirect(response) && location.includes("/admin/login"),
    `status ${response.status}, location "${location}"`,
  );
}

// 2. Server-side enforcement stands on its own: a forged cookie satisfies the
//    middleware's presence check but must still be rejected by the page.
{
  const response = await request("/admin", {
    headers: { cookie: "better-auth.session_token=forged.invalid-token" },
  });
  const location = response.headers.get("location") ?? "";
  check(
    "forged session cookie is rejected server-side, not merely by middleware",
    isRedirect(response) && location.includes("/admin/login"),
    `status ${response.status}, location "${location}"`,
  );
}

// 3. There must be no public registration.
{
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "intruder@example.invalid",
      password: "an-unusably-long-password",
      name: "Intruder",
    }),
  });
  check(
    "public sign-up endpoint is closed",
    response.status >= 400,
    `status ${response.status}`,
  );
}

// 4. Invalid credentials fail without revealing whether the account exists.
{
  const unknownAccount = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "nobody@example.invalid",
      password: "wrong-password-value",
    }),
  });
  const unknownBody = await unknownAccount.text();

  const wrongPassword = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "definitely-the-wrong-password" }),
  });
  const wrongBody = await wrongPassword.text();

  check(
    "invalid login is rejected",
    unknownAccount.status >= 400 && wrongPassword.status >= 400,
    `unknown ${unknownAccount.status}, wrong password ${wrongPassword.status}`,
  );
  check(
    "unknown email and wrong password are indistinguishable (no user enumeration)",
    unknownAccount.status === wrongPassword.status && unknownBody === wrongBody,
    `${unknownAccount.status} vs ${wrongPassword.status}`,
  );
  check(
    "failed login sets no session cookie",
    !sessionCookieFrom(unknownAccount) && !sessionCookieFrom(wrongPassword),
  );
}

// 5. Valid credentials establish a session.
let sessionCookie = null;
{
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  sessionCookie = sessionCookieFrom(response);
  const setCookies = response.headers.getSetCookie?.() ?? [];

  check(
    "valid login succeeds",
    response.status === 200,
    `status ${response.status}`,
  );
  check("valid login issues a session cookie", Boolean(sessionCookie));
  check(
    "session cookie is HttpOnly and SameSite-scoped",
    setCookies.some(
      (value) =>
        value.includes("session_token=") &&
        /httponly/i.test(value) &&
        /samesite=lax/i.test(value),
    ),
  );
}

if (!sessionCookie) {
  console.log("\n  Cannot continue without a session cookie.\n");
  process.exit(1);
}

// 6. The protected route now renders, and exposes the user's role.
{
  const response = await request("/admin", {
    headers: { cookie: sessionCookie },
  });
  const body = await response.text();

  check(
    "authenticated /admin returns 200",
    response.status === 200,
    `status ${response.status}`,
  );
  check("authenticated /admin shows the signed-in account", body.includes(email));
  check(
    "authenticated /admin resolves the role from the server",
    /Super admin|Admin|Editor/.test(body),
  );

  const session = await request("/api/auth/get-session", {
    headers: { cookie: sessionCookie },
  })
    .then((r) => r.json())
    .catch(() => null);
  check(
    "session endpoint reports the role",
    typeof session?.user?.role === "string",
    `role ${JSON.stringify(session?.user?.role)}`,
  );
}

// 7. An authenticated visitor is moved off the login page.
{
  const response = await request("/admin/login", {
    headers: { cookie: sessionCookie },
  });
  const location = response.headers.get("location") ?? "";
  check(
    "authenticated /admin/login redirects to /admin",
    isRedirect(response) && location.includes("/admin"),
    `status ${response.status}, location "${location}"`,
  );
}

// 8. The `next` parameter cannot be turned into an open redirect.
{
  const response = await request(
    "/admin/login?next=https%3A%2F%2Fevil.example%2Fsteal",
    { headers: { cookie: sessionCookie } },
  );
  const location = response.headers.get("location") ?? "";
  check(
    "external `next` target is refused (no open redirect)",
    !location.includes("evil.example"),
    `location "${location}"`,
  );
}

// 9. Sign-out revokes the session, and the same cookie stops working.
{
  const response = await request("/api/auth/sign-out", {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: "{}",
  });
  check("sign-out succeeds", response.status === 200, `status ${response.status}`);

  const afterSignOut = await request("/admin", {
    headers: { cookie: sessionCookie },
  });
  const location = afterSignOut.headers.get("location") ?? "";
  check(
    "the revoked session no longer grants access to /admin",
    isRedirect(afterSignOut) && location.includes("/admin/login"),
    `status ${afterSignOut.status}, location "${location}"`,
  );

  const session = await request("/api/auth/get-session", {
    headers: { cookie: sessionCookie },
  }).then((r) => r.json().catch(() => null));
  check("the revoked session no longer resolves", !session?.user);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
