import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../data/sqlite-adapter.js';
import { ColumnValidatorImpl } from '../column-validator.js';

describe('ColumnValidator', () => {
  let adapter: SqliteAdapter;
  let validator: ColumnValidatorImpl;

  beforeEach(() => {
    adapter = new SqliteAdapter(':memory:');
    adapter.open();
    adapter.run('CREATE TABLE users (id TEXT, name TEXT, email TEXT)');
    validator = new ColumnValidatorImpl(adapter);
  });

  afterEach(() => {
    adapter.close();
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

  it('invalidateCache clears the cache so fresh info is fetched', () => {
    // Fetch once to populate cache
    validator.validateRead('users', ['id', 'name']);
    // Add a new column
    adapter.run('ALTER TABLE users ADD COLUMN phone TEXT');
    // Without invalidation, the new column would not be known
    validator.invalidateCache('users');
    // Now it should know about phone
    expect(() => validator.validateRead('users', ['phone'])).not.toThrow();
  });
});
