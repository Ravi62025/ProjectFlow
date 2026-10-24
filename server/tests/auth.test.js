import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { startTestDb, clearTestDb, stopTestDb, TEST_JWT_SECRET } from "./helpers.js";
import app from "../src/app.js";
import User from "../src/models/User.js";

const USER = { name: "Test User", email: "test@example.com", password: "password123" };

// Creates a user through the real register route
const registerUser = async (user = USER) => {
  const res = await request(app).post("/api/auth/register").send(user);
  assert.equal(res.status, 201, "test setup: register should succeed");
  return res.body;
};

const login = (email, password) =>
  request(app).post("/api/auth/login").send({ email, password });

describe("authentication", () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(clearTestDb);

  test("tests run against a local in-memory database", () => {
    assert.match(String(mongoose.connection.host), /^(127\.0\.0\.1|localhost)$/);
  });

  describe("POST /api/auth/login", () => {
    test("rejects an email that is not registered", async () => {
      const res = await login("nobody@example.com", "password123");
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Invalid email or password" });
    });

    test("rejects a wrong password with the same message", async () => {
      await registerUser();
      const res = await login(USER.email, "wrong-password");
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Invalid email or password" });
    });

    test("rejects missing fields", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: USER.email });
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { message: "Email and password are required" });
    });

    test("returns a token and the user for correct credentials", async () => {
      const registered = await registerUser();
      const res = await login(USER.email, USER.password);

      assert.equal(res.status, 200);
      assert.equal(typeof res.body.token, "string");
      assert.deepEqual(res.body.user, {
        id: registered.id,
        name: USER.name,
        email: USER.email,
      });
      assert.equal("password" in res.body.user, false);

      // The token belongs to this user and lasts one day
      const payload = jwt.verify(res.body.token, TEST_JWT_SECRET);
      assert.equal(payload.sub, registered.id);
      assert.equal(payload.exp - payload.iat, 24 * 60 * 60);
    });

    test("accepts the email in a different case", async () => {
      await registerUser();
      const res = await login("  TEST@Example.com ", USER.password);
      assert.equal(res.status, 200);
    });
  });

  describe("GET /api/auth/me", () => {
    test("rejects a request without a token", async () => {
      const res = await request(app).get("/api/auth/me");
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Not authorized, token missing" });
    });

    test("rejects an Authorization header that is not a Bearer token", async () => {
      const res = await request(app).get("/api/auth/me").set("Authorization", "Token abc");
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Not authorized, token missing" });
    });

    test("rejects a token that is not valid", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer not-a-real-token");
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Not authorized, token invalid" });
    });

    test("rejects a token signed with a different secret", async () => {
      const registered = await registerUser();
      const forged = jwt.sign({}, "some-other-secret", { subject: registered.id });
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${forged}`);
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Not authorized, token invalid" });
    });

    test("rejects an expired token", async () => {
      const registered = await registerUser();
      const expired = jwt.sign(
        { exp: Math.floor(Date.now() / 1000) - 60 },
        TEST_JWT_SECRET,
        { subject: registered.id }
      );
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${expired}`);
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Not authorized, token invalid" });
    });

    test("rejects a valid token whose user no longer exists", async () => {
      const registered = await registerUser();
      const { body } = await login(USER.email, USER.password);
      await User.deleteOne({ _id: registered.id });

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${body.token}`);
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { message: "Not authorized, token invalid" });
    });

    test("returns the logged-in user for a valid token", async () => {
      const registered = await registerUser();
      const { body } = await login(USER.email, USER.password);

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${body.token}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        user: { id: registered.id, name: USER.name, email: USER.email },
      });
      assert.equal("password" in res.body.user, false);
    });
  });
});