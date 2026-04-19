'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { createSessionCookie, verifySessionCookie } = require('./auth');

/**
 * Feature: auth-layer
 * Property 1: Cookie signing round-trip
 *
 * For any arbitrary username string and role from ["admin", "volunteer"],
 * verifySessionCookie(createSessionCookie(u, r)) returns { username: u, role: r }.
 *
 * **Validates: Requirements 3.5, 4.4**
 */
describe('Property 1: Cookie signing round-trip', () => {
  it('verifySessionCookie(createSessionCookie(u, r)) === { username: u, role: r }', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom('admin', 'volunteer'),
        (username, role) => {
          const cookie = createSessionCookie(username, role);
          const result = verifySessionCookie(cookie);

          assert.notEqual(result, null, `Expected non-null result for username=${JSON.stringify(username)}, role=${role}`);
          assert.deepEqual(result, { username, role });
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: auth-layer
 * Property 2: Cookie tamper detection
 *
 * For any valid signed cookie string, modifying any single character in the
 * cookie value (in either the payload or signature portion) causes
 * verifySessionCookie to return null.
 *
 * **Validates: Requirements 4.5**
 */
describe('Property 2: Cookie tamper detection', () => {
  it('modifying any single character in a valid cookie causes verifySessionCookie to return null', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom('admin', 'volunteer'),
        fc.nat(),
        fc.integer({ min: 1, max: 127 }),
        (username, role, rawIndex, charOffset) => {
          const cookie = createSessionCookie(username, role);

          // Pick a random position in the cookie string
          const index = rawIndex % cookie.length;
          const originalChar = cookie.charCodeAt(index);

          // Produce a different character by shifting within printable ASCII range
          const newCharCode = ((originalChar - 32 + charOffset) % 95) + 32;
          if (newCharCode === originalChar) return; // skip if same char (extremely rare)

          const tampered =
            cookie.slice(0, index) +
            String.fromCharCode(newCharCode) +
            cookie.slice(index + 1);

          const result = verifySessionCookie(tampered);
          assert.equal(result, null, `Expected null for tampered cookie at index ${index}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Property 3 (old auth-layer "Credential matching correctness") removed —
// it referenced the deprecated validateCredentials() API which was replaced
// by the database-backed authenticate(db, username, password) in Task 2.
// The equivalent property is now covered by "multi-user-auth, Property 2:
// Authentication correctness" below.


/**
 * Feature: multi-user-auth, Property 1: Password hashing round-trip
 *
 * For any plaintext password string of 8 or more characters, hashing it with
 * `hashPassword` and then comparing the original plaintext against the resulting
 * hash with `bcryptjs.compareSync` SHALL return `true`, the hash SHALL be a valid
 * bcrypt string with cost factor ≥ 10, and the hash SHALL NOT equal the original
 * plaintext.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3**
 */
describe('Feature: multi-user-auth, Property 1: Password hashing round-trip', () => {
  const bcrypt = require('bcryptjs');
  const { hashPassword } = require('./auth');

  it('hashPassword produces a valid bcrypt hash that verifies against the original plaintext', () => {
    const passwordArb = fc.string({ minLength: 8, maxLength: 72 });

    fc.assert(
      fc.property(passwordArb, (plaintext) => {
        const hash = hashPassword(plaintext);

        // Hash must not equal the plaintext
        assert.notEqual(hash, plaintext, 'Hash must not equal the plaintext');

        // Hash must match bcrypt format: $2a$ or $2b$ followed by cost and 53 chars
        assert.match(hash, /^\$2[aby]?\$\d{2}\$.{53}$/, 'Hash must be a valid bcrypt string');

        // Cost factor must be >= 10
        const costStr = hash.split('$')[2];
        const cost = parseInt(costStr, 10);
        assert.ok(cost >= 10, `Cost factor must be >= 10, got ${cost}`);

        // Round-trip: compareSync must return true
        assert.ok(bcrypt.compareSync(plaintext, hash), 'bcrypt.compareSync(plaintext, hash) must return true');
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: multi-user-auth, Property 2: Authentication correctness
 *
 * For any user record in the `users` table with a given username, password hash,
 * and role, calling `authenticate(db, username, correctPassword)` SHALL return
 * `{ role }`, and calling `authenticate(db, username, anyOtherPassword)` where
 * `anyOtherPassword !== correctPassword` SHALL return `null`. Furthermore, calling
 * `authenticate(db, nonExistentUsername, anyPassword)` SHALL return `null`, and the
 * error path for a missing username SHALL be indistinguishable from the error path
 * for a wrong password.
 *
 * **Validates: Requirements 3.1, 3.3, 3.4, 3.5**
 */
describe('Feature: multi-user-auth, Property 2: Authentication correctness', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { hashPassword, authenticate, addUser } = require('./auth');

  /**
   * Helper: create a fresh in-memory DB with the users table.
   */
  function createTestDb() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('admin', 'volunteer'))
      )
    `);
    return db;
  }

  it('authenticate returns { role } for correct password, null for wrong password, null for non-existent user', () => {
    // Generate usernames that are valid non-empty strings without SQL-problematic chars
    const usernameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);
    const passwordArb = fc.string({ minLength: 8, maxLength: 72 });
    const roleArb = fc.constantFrom('admin', 'volunteer');
    // Wrong password: guaranteed different from the correct one
    const wrongPasswordArb = fc.string({ minLength: 8, maxLength: 72 });

    fc.assert(
      fc.property(
        usernameArb,
        passwordArb,
        roleArb,
        wrongPasswordArb,
        (username, correctPassword, role, wrongPassword) => {
          // Skip if wrong password happens to equal the correct one
          fc.pre(wrongPassword !== correctPassword);

          const db = createTestDb();

          // Insert user with hashed password
          const hash = hashPassword(correctPassword);
          addUser(db, username, hash, role);

          // Correct password should return { role }
          const successResult = authenticate(db, username, correctPassword);
          assert.deepStrictEqual(successResult, { role },
            `Expected { role: '${role}' } for correct password, got ${JSON.stringify(successResult)}`);

          // Wrong password should return null
          const wrongResult = authenticate(db, username, wrongPassword);
          assert.strictEqual(wrongResult, null,
            `Expected null for wrong password, got ${JSON.stringify(wrongResult)}`);

          // Non-existent username should return null
          const nonExistentUser = username + '_nonexistent';
          const missingResult = authenticate(db, nonExistentUser, correctPassword);
          assert.strictEqual(missingResult, null,
            `Expected null for non-existent user, got ${JSON.stringify(missingResult)}`);

          db.close();
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: multi-user-auth, Property 3: Username uniqueness enforcement
 *
 * For any username string, after successfully inserting a user with that username
 * into the `users` table, attempting to insert another user with the same username
 * SHALL fail (throw or return an error), and the original user's data SHALL remain
 * unchanged.
 *
 * **Validates: Requirements 1.2, 5.3**
 */
describe('Feature: multi-user-auth, Property 3: Username uniqueness enforcement', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { addUser, hashPassword } = require('./auth');

  /**
   * Helper: create a fresh in-memory DB with the users table.
   */
  function createTestDb() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('admin', 'volunteer'))
      )
    `);
    return db;
  }

  it('inserting a duplicate username throws and leaves the original user unchanged', () => {
    const usernameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);
    const passwordArb = fc.string({ minLength: 8, maxLength: 72 });
    const roleArb = fc.constantFrom('admin', 'volunteer');

    fc.assert(
      fc.property(
        usernameArb,
        passwordArb,
        passwordArb,
        roleArb,
        roleArb,
        (username, password1, password2, role1, role2) => {
          const db = createTestDb();

          const hash1 = hashPassword(password1);
          const hash2 = hashPassword(password2);

          // First insert should succeed
          addUser(db, username, hash1, role1);

          // Second insert with the same username must throw
          assert.throws(
            () => addUser(db, username, hash2, role2),
            (err) => err instanceof Error,
            'Expected addUser to throw on duplicate username'
          );

          // Original user's data must be unchanged
          const row = db.prepare('SELECT password_hash, role FROM users WHERE username = ?').get(username);
          assert.notEqual(row, undefined, 'Original user should still exist');
          assert.strictEqual(row.password_hash, hash1, 'Original password_hash should be unchanged');
          assert.strictEqual(row.role, role1, 'Original role should be unchanged');

          // Only one row with that username should exist
          const count = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE username = ?').get(username);
          assert.strictEqual(count.cnt, 1, 'There should be exactly one user with that username');

          db.close();
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: multi-user-auth, Property 4: Role validation
 *
 * For any string that is not "admin" or "volunteer", attempting to add a user
 * with that role SHALL be rejected (the SQLite CHECK constraint causes addUser
 * to throw). For any string that is "admin" or "volunteer", the role SHALL be
 * accepted and the user inserted successfully.
 *
 * **Validates: Requirements 1.3, 5.4**
 */
describe('Feature: multi-user-auth, Property 4: Role validation', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { addUser, hashPassword } = require('./auth');

  /**
   * Helper: create a fresh in-memory DB with the users table and CHECK constraint.
   */
  function createTestDb() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('admin', 'volunteer'))
      )
    `);
    return db;
  }

  it('rejects any role string that is not "admin" or "volunteer"', () => {
    const invalidRoleArb = fc.string({ minLength: 0, maxLength: 50 })
      .filter(s => s !== 'admin' && s !== 'volunteer');

    fc.assert(
      fc.property(invalidRoleArb, (invalidRole) => {
        const db = createTestDb();
        const hash = hashPassword('password1234');

        assert.throws(
          () => addUser(db, 'testuser', hash, invalidRole),
          (err) => err instanceof Error,
          `Expected addUser to throw for invalid role: ${JSON.stringify(invalidRole)}`
        );

        // Verify no user was inserted
        const count = db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
        assert.strictEqual(count.cnt, 0, 'No user should be inserted with an invalid role');

        db.close();
      }),
      { numRuns: 100 }
    );
  });

  it('accepts "admin" and "volunteer" as valid roles', () => {
    const validRoleArb = fc.constantFrom('admin', 'volunteer');
    const usernameArb = fc.string({ minLength: 1, maxLength: 30 })
      .filter(s => s.trim().length > 0);

    fc.assert(
      fc.property(usernameArb, validRoleArb, (username, role) => {
        const db = createTestDb();
        const hash = hashPassword('password1234');

        // Should not throw
        addUser(db, username, hash, role);

        // Verify user was inserted with the correct role
        const row = db.prepare('SELECT role FROM users WHERE username = ?').get(username);
        assert.notEqual(row, undefined, 'User should exist after addUser');
        assert.strictEqual(row.role, role, `Expected role to be '${role}'`);

        db.close();
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: multi-user-auth, Property 5: Input validation for username and password
 *
 * *For any* username that is empty, only whitespace, or not a string, the add-user
 * operation SHALL reject it. *For any* password shorter than 8 characters, the
 * add-user operation SHALL reject it. *For any* valid username (non-empty string)
 * and valid password (≥ 8 characters), the add-user operation SHALL accept them.
 *
 * **Validates: Requirements 5.5, 5.6**
 */
describe('Feature: multi-user-auth, Property 5: Input validation for username and password', () => {
  const { validateUserInput } = require('./auth');

  it('rejects empty, whitespace-only, or non-string usernames', () => {
    // Generate values that are not valid usernames:
    // - non-string types (numbers, booleans, null, undefined, objects, arrays)
    // - empty string
    // - whitespace-only strings
    const invalidUsernameArb = fc.oneof(
      fc.constant(''),
      fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 20 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.constant({}),
      fc.constant([])
    );
    const validPasswordArb = fc.string({ minLength: 8, maxLength: 72 });
    const validRoleArb = fc.constantFrom('admin', 'volunteer');

    fc.assert(
      fc.property(invalidUsernameArb, validPasswordArb, validRoleArb, (username, password, role) => {
        const result = validateUserInput(username, password, role);
        assert.notEqual(result, null, `Expected rejection for username=${JSON.stringify(username)}`);
        assert.strictEqual(result.error, 'Username is required');
      }),
      { numRuns: 100 }
    );
  });

  it('rejects missing, empty, or short passwords (< 8 characters)', () => {
    const validUsernameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);
    // Generate passwords that are too short or not strings
    const invalidPasswordArb = fc.oneof(
      fc.constant(''),
      fc.string({ minLength: 1, maxLength: 7 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined)
    );
    const validRoleArb = fc.constantFrom('admin', 'volunteer');

    fc.assert(
      fc.property(validUsernameArb, invalidPasswordArb, validRoleArb, (username, password, role) => {
        const result = validateUserInput(username, password, role);
        assert.notEqual(result, null, `Expected rejection for password=${JSON.stringify(password)}`);
        assert.strictEqual(result.error, 'Password must be at least 8 characters');
      }),
      { numRuns: 100 }
    );
  });

  it('accepts valid username (non-empty, non-whitespace string) and valid password (≥ 8 chars)', () => {
    const validUsernameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);
    const validPasswordArb = fc.string({ minLength: 8, maxLength: 72 });
    const validRoleArb = fc.constantFrom('admin', 'volunteer');

    fc.assert(
      fc.property(validUsernameArb, validPasswordArb, validRoleArb, (username, password, role) => {
        const result = validateUserInput(username, password, role);
        assert.strictEqual(result, null, `Expected acceptance for username=${JSON.stringify(username)}, password length=${password.length}, role=${role}, got ${JSON.stringify(result)}`);
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: multi-user-auth, Property 6: User deletion correctness
 *
 * *For any* user added to the `users` table, calling `removeUser(db, username)`
 * SHALL return `true` and the user SHALL no longer be retrievable from the store.
 * Calling `removeUser(db, nonExistentUsername)` SHALL return `false`.
 *
 * **Validates: Requirements 6.1, 6.3**
 */
describe('Feature: multi-user-auth, Property 6: User deletion correctness', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { addUser, removeUser, hashPassword, authenticate } = require('./auth');

  /**
   * Helper: create a fresh in-memory DB with the users table.
   */
  function createTestDb() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('admin', 'volunteer'))
      )
    `);
    return db;
  }

  it('adding a user then deleting it returns true and the user is no longer retrievable', () => {
    const usernameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);
    const passwordArb = fc.string({ minLength: 8, maxLength: 72 });
    const roleArb = fc.constantFrom('admin', 'volunteer');

    fc.assert(
      fc.property(usernameArb, passwordArb, roleArb, (username, password, role) => {
        const db = createTestDb();

        const hash = hashPassword(password);
        addUser(db, username, hash, role);

        // removeUser should return true for an existing user
        const deleted = removeUser(db, username);
        assert.strictEqual(deleted, true, 'removeUser should return true for an existing user');

        // The user should no longer be retrievable via authenticate
        const authResult = authenticate(db, username, password);
        assert.strictEqual(authResult, null, 'authenticate should return null after user is deleted');

        // The user should no longer exist in the table
        const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        assert.strictEqual(row, undefined, 'User row should not exist after deletion');

        db.close();
      }),
      { numRuns: 100 }
    );
  });

  it('deleting a non-existent username returns false', () => {
    const usernameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);

    fc.assert(
      fc.property(usernameArb, (username) => {
        const db = createTestDb();

        // No users inserted — removeUser should return false
        const deleted = removeUser(db, username);
        assert.strictEqual(deleted, false, 'removeUser should return false for a non-existent user');

        db.close();
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: multi-user-auth, Property 7: User list faithfulness
 *
 * *For any* set of users added to the `users` table, calling `listUsers(db)`
 * SHALL return an array containing exactly those users with their correct
 * `username` and `role` fields, and SHALL NOT include any `password_hash` field
 * in any returned object.
 *
 * **Validates: Requirements 7.1, 7.2**
 */
describe('Feature: multi-user-auth, Property 7: User list faithfulness', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { addUser, listUsers, hashPassword } = require('./auth');

  /**
   * Helper: create a fresh in-memory DB with the users table.
   */
  function createTestDb() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('admin', 'volunteer'))
      )
    `);
    return db;
  }

  it('listUsers returns exactly the inserted users with username and role only, no password_hash', () => {
    // Generate an array of unique (username, role) pairs
    const userArb = fc.record({
      username: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
      role: fc.constantFrom('admin', 'volunteer'),
    });

    const usersArb = fc.uniqueArray(userArb, {
      minLength: 0,
      maxLength: 20,
      comparator: (a, b) => a.username === b.username,
    });

    fc.assert(
      fc.property(usersArb, (users) => {
        const db = createTestDb();

        // Insert all users with hashed passwords
        for (const u of users) {
          const hash = hashPassword('password1234');
          addUser(db, u.username, hash, u.role);
        }

        // Call listUsers
        const result = listUsers(db);

        // 1. The returned array has the same length as the inserted set
        assert.strictEqual(result.length, users.length,
          `Expected ${users.length} users, got ${result.length}`);

        // 2. Each returned object has only username and role fields (no password_hash)
        for (const row of result) {
          const keys = Object.keys(row);
          assert.deepStrictEqual(keys.sort(), ['role', 'username'],
            `Expected only username and role keys, got ${JSON.stringify(keys)}`);
          assert.strictEqual('password_hash' in row, false,
            'password_hash must not be present in listUsers output');
        }

        // 3. The set of (username, role) pairs matches exactly
        const expectedSet = new Set(users.map(u => `${u.username}::${u.role}`));
        const actualSet = new Set(result.map(r => `${r.username}::${r.role}`));
        assert.deepStrictEqual(actualSet, expectedSet,
          'The set of (username, role) pairs must match exactly');

        db.close();
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: multi-user-auth, Property 8: Bulk add correctness
 *
 * *For any* batch of user objects, the bulk add operation SHALL create all entries
 * that have valid and unique usernames, valid passwords (≥ 8 chars), and valid roles
 * ("admin" or "volunteer"), and SHALL skip entries with duplicate usernames (within
 * the batch or already in the store), invalid roles, or missing/invalid fields. The
 * `created` count SHALL equal the number of successfully inserted users, and the
 * `skipped` array SHALL contain the usernames (or indices) of all skipped entries.
 *
 * **Validates: Requirements 8.1, 8.3, 8.4**
 */
describe('Feature: multi-user-auth, Property 8: Bulk add correctness', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { validateUserInput, hashPassword, listUsers } = require('./auth');

  /**
   * Helper: create a fresh in-memory DB with the users table.
   */
  function createTestDb() {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('admin', 'volunteer'))
      )
    `);
    return db;
  }

  /**
   * Mimics the bulk add logic from server.js POST /api/users/bulk handler.
   * For each entry: validate → hash → INSERT OR IGNORE → track created/skipped.
   */
  function bulkAdd(db, batch) {
    let created = 0;
    const skipped = [];
    const insertStmt = db.prepare(
      'INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    );
    db.exec('BEGIN');
    try {
      for (const entry of batch) {
        const invalid = validateUserInput(entry.username, entry.password, entry.role);
        if (invalid) {
          skipped.push(entry.username != null ? String(entry.username) : '(invalid)');
          continue;
        }
        const hash = hashPassword(entry.password);
        const result = insertStmt.run(entry.username, hash, entry.role);
        if (result.changes > 0) {
          created++;
        } else {
          skipped.push(entry.username);
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { created, skipped };
  }

  // ── Arbitraries ──────────────────────────────────────────────────────────

  // A valid user entry: non-empty trimmed username, password ≥ 8 chars, valid role
  const validEntryArb = fc.record({
    username: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
    password: fc.string({ minLength: 8, maxLength: 30 }),
    role: fc.constantFrom('admin', 'volunteer'),
  });

  // An invalid entry: bad role, short password, or empty username
  const invalidEntryArb = fc.oneof(
    // Bad role
    fc.record({
      username: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
      password: fc.string({ minLength: 8, maxLength: 30 }),
      role: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s !== 'admin' && s !== 'volunteer'),
    }),
    // Short password
    fc.record({
      username: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
      password: fc.string({ minLength: 0, maxLength: 7 }),
      role: fc.constantFrom('admin', 'volunteer'),
    }),
    // Empty / whitespace username
    fc.record({
      username: fc.constantFrom('', '   ', '\t'),
      password: fc.string({ minLength: 8, maxLength: 30 }),
      role: fc.constantFrom('admin', 'volunteer'),
    })
  );

  it('created + skipped.length === batch.length and created matches actual DB inserts', () => {
    // Build a batch that mixes valid, duplicate, and invalid entries
    const batchArb = fc.tuple(
      fc.array(validEntryArb, { minLength: 0, maxLength: 10 }),
      fc.array(invalidEntryArb, { minLength: 0, maxLength: 5 })
    ).chain(([validEntries, invalidEntries]) => {
      // Optionally duplicate some valid entries to create within-batch duplicates
      const dupsArb = validEntries.length > 0
        ? fc.array(
            fc.nat({ max: Math.max(validEntries.length - 1, 0) }).map(i => ({
              ...validEntries[i],
              password: validEntries[i].password + '_dup',
            })),
            { minLength: 0, maxLength: 3 }
          )
        : fc.constant([]);

      return dupsArb.map(dups => {
        // Shuffle all entries together
        const all = [...validEntries, ...invalidEntries, ...dups];
        // Simple deterministic shuffle based on index parity
        return all.sort((a, b) => {
          const ha = a.username.length + (a.password ? a.password.length : 0);
          const hb = b.username.length + (b.password ? b.password.length : 0);
          return ha - hb;
        });
      });
    });

    fc.assert(
      fc.property(batchArb, (batch) => {
        const db = createTestDb();
        const { created, skipped } = bulkAdd(db, batch);

        // Invariant 1: created + skipped.length === batch.length
        assert.strictEqual(
          created + skipped.length,
          batch.length,
          `created (${created}) + skipped (${skipped.length}) must equal batch length (${batch.length})`
        );

        // Invariant 2: created matches the actual number of rows in the DB
        const rows = listUsers(db);
        assert.strictEqual(
          rows.length,
          created,
          `DB row count (${rows.length}) must equal created count (${created})`
        );

        // Invariant 3: every valid, first-occurrence entry should be created
        const seenUsernames = new Set();
        let expectedCreated = 0;
        for (const entry of batch) {
          const invalid = validateUserInput(entry.username, entry.password, entry.role);
          if (invalid) continue;
          if (seenUsernames.has(entry.username)) continue;
          seenUsernames.add(entry.username);
          expectedCreated++;
        }
        assert.strictEqual(
          created,
          expectedCreated,
          `Expected ${expectedCreated} created, got ${created}`
        );

        db.close();
      }),
      { numRuns: 100 }
    );
  });
});
