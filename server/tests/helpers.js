import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Test environment. Importing this file only sets variables; it never connects.
// The tests must never reach a real database, so any MONGO_URI is removed and the
// JWT secret is a fixed test value instead of the one in .env.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-jwt-secret";
delete process.env.MONGO_URI;

export const TEST_JWT_SECRET = process.env.JWT_SECRET;

let mongod = null;

// Starts a throwaway in-memory MongoDB and connects mongoose to it.
export async function startTestDb() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  // Safety check: only ever connect to a database on this machine.
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(uri)) {
    await mongod.stop();
    mongod = null;
    throw new Error(`Refusing to run tests against a non-local database: ${uri}`);
  }

  await mongoose.connect(uri);

  // Build indexes (for example the unique email index) before any test runs
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

// Empties every collection but keeps the indexes.
export async function clearTestDb() {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export async function stopTestDb() {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}