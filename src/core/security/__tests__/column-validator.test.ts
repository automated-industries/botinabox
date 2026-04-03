import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { ColumnValidatorImpl } from '../column-validator.js';

describe('ColumnValidator', () => {
  let db: DataStore;
  let validator: ColumnValidatorImpl;

  beforeEach(async () => {
    db = new DataStore({ dbPath: ':memory:' });
    defineCoreTables(db);
    db.define('users', {
      columns: {
        id: 'TEXT PRIMARY KEY',
        name: 'TEXT',
        email: 'TEXT',
      },
    });
    await db.init();
    validator = new ColumnValidatorImpl(db);
  });

  afterEach(() => {
    db.close();
  });

  it('validateWrite strips unknown columns', () => {
    const row = { id: '1', name: 'Alice', email: 'alice@example.com', hacker: 'DROP TABLE' };
    const result = validator.validateWrite('users', row);
    expect(result).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
    expect('hacker' in result).toBe(false);
  });

  it('validateWrite returns all valid columns unchanged', () => {
    const row = { id: '2', name: 'Bob', email: 'bob@example.com' };
    const result = validator.validateWrite('users', row);
    expect(result).toEqual(row);
  });

  it('validateRead with valid columns does not throw', () => {
    expect(() => validator.validateRead('users', ['id', 'name', 'email'])).not.toThrow();
  });

  it('validateRead with unknown column throws', () => {
    expect(() => validator.validateRead('users', ['id', 'hacker'])).toThrow(
      'Unknown column: hacker in table users',
    );
  });

  it('invalidateCache clears the cache so fresh info is fetched', async () => {
    // Fetch once to populate cache
    validator.validateRead('users', ['id', 'name']);
    // Add a new column via raw SQL through a migration
    await db.migrate([{ version: 'test:add-phone', sql: 'ALTER TABLE users ADD COLUMN phone TEXT' }]);
    // Without invalidation, the new column would not be known
    validator.invalidateCache('users');
    // Now it should know about phone
    expect(() => validator.validateRead('users', ['phone'])).not.toThrow();
  });
});
