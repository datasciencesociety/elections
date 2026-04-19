'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('auth.js', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Set valid credentials for tests that need them
    process.env.ADMIN_USER = 'admin';
    process.env.ADMIN_PASS = 'adminpass';
    process.env.VOLUNTEER_USER = 'volunteer';
    process.env.VOLUNTEER_PASS = 'volpass';
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clear the module cache so each test gets a fresh auth module
    delete require.cache[require.resolve('./auth')];
  });

  describe('validateCredentials', () => {
    it('should succeed when all env vars are set', () => {
      const { validateCredentials } = require('./auth');
      // Should not throw or exit
      validateCredentials();
    });

    for (const varName of ['ADMIN_USER', 'ADMIN_PASS', 'VOLUNTEER_USER', 'VOLUNTEER_PASS']) {
      it(`should exit with code 1 when ${varName} is missing`, () => {
        delete process.env[varName];
        const { validateCredentials } = require('./auth');

        const logs = [];
        const origError = console.error;
        console.error = (...args) => logs.push(args.join(' '));

        let exitCode = null;
        const origExit = process.exit;
        process.exit = (code) => { exitCode = code; };

        try {
          validateCredentials();
          assert.equal(exitCode, 1, `Expected process.exit(1) for missing ${varName}`);
          assert.ok(logs.some(l => l.includes(varName)), `Expected log to mention ${varName}`);
        } finally {
          console.error = origError;
          process.exit = origExit;
        }
      });

      it(`should exit with code 1 when ${varName} is empty string`, () => {
        process.env[varName] = '';
        const { validateCredentials } = require('./auth');

        const logs = [];
        const origError = console.error;
        console.error = (...args) => logs.push(args.join(' '));

        let exitCode = null;
        const origExit = process.exit;
        process.exit = (code) => { exitCode = code; };

        try {
          validateCredentials();
          assert.equal(exitCode, 1, `Expected process.exit(1) for empty ${varName}`);
          assert.ok(logs.some(l => l.includes(varName)), `Expected log to mention ${varName}`);
        } finally {
          console.error = origError;
          process.exit = origExit;
        }
      });
    }
  });

  describe('authenticate', () => {
    it('should return { role: "admin" } for admin credentials', () => {
      const { validateCredentials, authenticate } = require('./auth');
      validateCredentials();
      const result = authenticate('admin', 'adminpass');
      assert.deepEqual(result, { role: 'admin' });
    });

    it('should return { role: "volunteer" } for volunteer credentials', () => {
      const { validateCredentials, authenticate } = require('./auth');
      validateCredentials();
      const result = authenticate('volunteer', 'volpass');
      assert.deepEqual(result, { role: 'volunteer' });
    });

    it('should return null for invalid credentials', () => {
      const { validateCredentials, authenticate } = require('./auth');
      validateCredentials();
      assert.equal(authenticate('wrong', 'creds'), null);
    });

    it('should return null for correct username but wrong password', () => {
      const { validateCredentials, authenticate } = require('./auth');
      validateCredentials();
      assert.equal(authenticate('admin', 'wrongpass'), null);
    });

    it('should return null when credentials have not been validated', () => {
      const { authenticate } = require('./auth');
      assert.equal(authenticate('admin', 'adminpass'), null);
    });
  });
});
