const USERS_KEY = "auth:users";
const SESSION_PREFIX = "auth:session:";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210000;
const encoder = new TextEncoder();

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function normalizedName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return hex(bits);
}

function equalHash(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function safeUser(user) {
  return { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt };
}

function validCredentials(name, password) {
  return name.length >= 2 && name.length <= 60 &&
    typeof password === "string" && password.length >= 12 && password.length <= 128;
}

async function getUsers(storage) {
  const users = await storage.get(USERS_KEY);
  return Array.isArray(users) ? users : [];
}

async function sessionFor(request, storage) {
  const auth = request.headers.get("Authorization") || "";
  const token = request.headers.get("X-App-Auth") ||
    (auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim());
  if (!token || token.length > 256) return null;
  const key = SESSION_PREFIX + await sha256(token);
  const session = await storage.get(key);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) await storage.delete(key);
    return null;
  }
  const user = (await getUsers(storage)).find(item => item.id === session.userId);
  if (!user) {
    await storage.delete(key);
    return null;
  }
  return { user, key };
}

async function createSession(user, storage) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await storage.put(SESSION_PREFIX + await sha256(token), { userId: user.id, expiresAt });
  return { token, expiresAt, user: safeUser(user) };
}

async function revokeSessions(userId, storage, exceptKey = "") {
  const sessions = await storage.list({ prefix: SESSION_PREFIX });
  for (const [key, value] of sessions.entries()) {
    if (key !== exceptKey && value.userId === userId) await storage.delete(key);
  }
}

export async function handleAuthRequest(request, storage) {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/auth/status") {
    const users = await getUsers(storage);
    return response({ setupRequired: users.length === 0, userCount: users.length });
  }

  const body = request.method === "POST" ? await request.json().catch(() => null) : null;
  if (request.method === "POST" && (!body || typeof body !== "object" || Array.isArray(body))) {
    return response({ error: "A valid JSON request body is required." }, 400);
  }

  if (request.method === "POST" && path === "/api/auth/bootstrap") {
    if (request.headers.get("X-Bootstrap-Authorized") !== "true") {
      return response({ error: "Initial setup requires the Gateway Secret." }, 401);
    }
    const name = normalizedName(body.name);
    if (!validCredentials(name, body.password)) {
      return response({ error: "Use a name of 2–60 characters and a password of 12–128 characters." }, 400);
    }
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(body.password, salt);
    const user = {
      id: crypto.randomUUID(), name, normalizedName: name.toLowerCase(),
      role: "admin", salt, passwordHash: hash, createdAt: new Date().toISOString()
    };
    const created = await storage.transaction(async txn => {
      const users = await txn.get(USERS_KEY) || [];
      if (users.length) return false;
      await txn.put(USERS_KEY, [user]);
      return true;
    });
    if (!created) return response({ error: "Initial admin account has already been created." }, 409);
    return response(await createSession(user, storage), 201);
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    const name = normalizedName(body.name);
    if (!name || typeof body.password !== "string" || body.password.length > 128) {
      return response({ error: "Invalid name or password." }, 400);
    }
    const user = (await getUsers(storage)).find(item => item.normalizedName === name.toLowerCase());
    const salt = user?.salt || "portfolio-terminal-login-check";
    const expected = user?.passwordHash || await passwordHash("not-the-password", salt);
    const actual = await passwordHash(body.password, salt);
    if (!user || !equalHash(actual, expected)) return response({ error: "Invalid name or password." }, 401);
    return response(await createSession(user, storage));
  }

  if (request.method === "POST" && path === "/api/auth/verify") {
    const session = await sessionFor(request, storage);
    return session ? response({ user: safeUser(session.user) }) : response({ error: "Session is invalid or expired." }, 401);
  }

  const session = await sessionFor(request, storage);
  if (!session) return response({ error: "Authentication required." }, 401);
  if (request.method === "GET" && path === "/api/auth/me") return response({ user: safeUser(session.user) });
  if (request.method === "POST" && path === "/api/auth/logout") {
    await storage.delete(session.key);
    return response({ success: true });
  }

  if (path === "/api/auth/users" && request.method === "GET") {
    if (session.user.role !== "admin") return response({ error: "Admin role required." }, 403);
    return response({ users: (await getUsers(storage)).map(safeUser) });
  }

  if (path === "/api/auth/users" && request.method === "POST") {
    if (session.user.role !== "admin") return response({ error: "Admin role required." }, 403);

    if (body.action === "create") {
      const name = normalizedName(body.name);
      const role = body.role === "admin" ? "admin" : "guest";
      if (!validCredentials(name, body.password)) return response({ error: "Use a name of 2–60 characters and a password of 12–128 characters." }, 400);
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const hash = await passwordHash(body.password, salt);
      const user = {
        id: crypto.randomUUID(), name, normalizedName: name.toLowerCase(), role,
        salt, passwordHash: hash, createdAt: new Date().toISOString()
      };
      const created = await storage.transaction(async txn => {
        const users = await txn.get(USERS_KEY) || [];
        if (users.some(item => item.normalizedName === user.normalizedName)) return false;
        await txn.put(USERS_KEY, [...users, user]);
        return true;
      });
      return created ? response({ user: safeUser(user) }, 201) : response({ error: "A user with this name already exists." }, 409);
    }

    if (body.action === "update") {
      const id = typeof body.id === "string" ? body.id : "";
      const name = body.name === undefined ? undefined : normalizedName(body.name);
      const role = body.role === undefined ? undefined : body.role;
      const password = body.password;
      if (!id || (name !== undefined && (name.length < 2 || name.length > 60)) ||
          (role !== undefined && role !== "guest" && role !== "admin") ||
          (password !== undefined && password !== "" && (typeof password !== "string" || password.length < 12 || password.length > 128))) {
        return response({ error: "Invalid user update. Passwords must be 12–128 characters when changed." }, 400);
      }
      const salt = password ? hex(crypto.getRandomValues(new Uint8Array(16))) : undefined;
      const hash = salt ? await passwordHash(password, salt) : undefined;
      const updated = await storage.transaction(async txn => {
        const users = await txn.get(USERS_KEY) || [];
        const index = users.findIndex(item => item.id === id);
        if (index < 0) return { error: "User not found.", status: 404 };
        const current = users[index];
        const nextRole = role || current.role;
        if (name && users.some(item => item.id !== id && item.normalizedName === name.toLowerCase())) {
          return { error: "A user with this name already exists.", status: 409 };
        }
        if (current.role === "admin" && nextRole !== "admin" && users.filter(item => item.role === "admin").length < 2) {
          return { error: "At least one admin account must remain." , status: 409 };
        }
        const next = {
          ...current,
          ...(name ? { name, normalizedName: name.toLowerCase() } : {}),
          ...(role ? { role } : {}),
          ...(salt && hash ? { salt, passwordHash: hash } : {})
        };
        const nextUsers = [...users];
        nextUsers[index] = next;
        await txn.put(USERS_KEY, nextUsers);
        return { user: next };
      });
      if (updated.error) return response({ error: updated.error }, updated.status);
      if (salt) await revokeSessions(id, storage, session.key);
      return response({ user: safeUser(updated.user) });
    }

    if (body.action === "delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id || id === session.user.id) return response({ error: "You cannot delete the currently signed-in account." }, 400);
      const removed = await storage.transaction(async txn => {
        const users = await txn.get(USERS_KEY) || [];
        const target = users.find(item => item.id === id);
        if (!target) return { error: "User not found.", status: 404 };
        if (target.role === "admin" && users.filter(item => item.role === "admin").length < 2) {
          return { error: "At least one admin account must remain.", status: 409 };
        }
        await txn.put(USERS_KEY, users.filter(item => item.id !== id));
        return { success: true };
      });
      if (removed.error) return response({ error: removed.error }, removed.status);
      await revokeSessions(id, storage);
      return response({ success: true });
    }
  }

  return response({ error: "Unsupported authentication endpoint." }, 404);
}
