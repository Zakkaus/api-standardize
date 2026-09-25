---
title: Authentication
---

# Authentication

Password-mode discovery selects setup or login. See [Discovery](discovery.html)
for the client selection rules.

Credentials require a `username` matching `[A-Za-z0-9_.-]{1,64}` and a
`password` of 8 to 128 Unicode scalar values and at most 512 UTF-8 bytes.
The server does not trim either value. Setup and login requests must not include
an `Authorization` header. A request that includes one is authenticated first
and gets `401 authentication_required` unless the header carries a live session.

## POST /api/v1/auth/setup

Creates the administrator account and opens a session. It is available only in
password mode while `auth.setup_required` is true.

### Request

{% api_request setupAdministrator administrator %}

Only loopback, RFC 1918, RFC 4193 ULA, and link-local peers may call setup.
Other peers receive `403 permission_denied` before the server reads account
state.

### Created (201 Created)

{% api_example setupAdministrator 201 created http %}

The returned `token` is a bearer credential for later requests. It expires at
`expires_at`; honk sessions expire after 12 hours.

| Status and code | Meaning |
|-----------------|---------|
| `401 authentication_required` | The request carries an `Authorization` header. Resend it without one. |
| `409 setup_already_completed` | An administrator already exists. Use login. |
| `429 rate_limited` | Setup is rate limited. Respect `Retry-After`. |

## POST /api/v1/auth/login

Opens a session with the administrator credentials. It is available in password
mode after setup.

### Request

{% api_request login administrator %}

### Success (200 OK)

{% api_example login 200 opened http %}

The returned `token` is a bearer credential for later requests. It expires at
`expires_at`; honk sessions expire after 12 hours.

| Status and code | Meaning |
|-----------------|---------|
| `401 invalid_credentials` | The username or password is incorrect. |
| `409 setup_required` | No administrator exists. Use setup. |
| `429 rate_limited` | Login is rate limited. Respect `Retry-After`. |

## POST /api/v1/auth/logout

Ends only the password session that authenticates this request. A configured
bearer cannot log out.

### Request

{% api_request logout %}

### Success (204 No Content)

Send the session token as a bearer credential. The endpoint does not end other
sessions.

Clients must branch on error codes, never on error messages.
