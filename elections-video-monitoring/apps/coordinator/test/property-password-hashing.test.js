'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const bcrypt = require('bcryptjs');
const { hashPassword } = require('../auth.js');

/**
 * Feature: multi-user-auth, Property 1: Password hashing round-trip
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 *
 * For any plaintext password string of 8 or more characters, hashing it with
 * hashPassword and then comparing the original plaintext against the resulting
 * hash with bcryptjs.compareSync SHALL return true, the hash SHALL be a valid
 * bcrypt string with cost factor >= 10, and the hash SHALL NOT equal the
 * original plaintext.
 */
describe('Feature: multi-user-auth, Property 1: Password hashing round-trip', () => {
  it('hashing a password and comparing with bcrypt.compareSync returns true, hash is valid bcrypt with cost >= 10, and hash !== plaintext', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 72 }),
        (plaintext) => {
          const hash = hashPassword(plaintext);

          // 1. Round-trip: compareSync(plain, hash) must be true
          assert.equal(
            bcrypt.compareSync(plaintext, hash),
            true,
            'bcrypt.compareSync(plaintext, hash) should return true'
          );

          // 2. Hash matches bcrypt format ($2a$ or $2b$) with cost >= 10
          const match = hash.match(/^\$(2[ab])\$(\d{2})\$/);
          assert.ok(match, `Hash should match bcrypt format, got: ${hash}`);
          const cost = parseInt(match[2], 10);
          assert.ok(cost >= 10, `Cost factor should be >= 10, got: ${cost}`);

          // 3. Hash must not equal the plaintext
          assert.notEqual(hash, plaintext, 'Hash should not equal the plaintext');
        }
      ),
      { numRuns: 100 }
    );
  });
});
