import { describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import "./helpers.js"; // sets the test environment only; it does not connect
import app, { errorHandler } from "../src/app.js";

// None of these requests reach the database, so no database is started.

describe("JSON 404", () => {
  test("an unknown GET route returns a JSON 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    assert.equal(res.status, 404);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.deepEqual(res.body, { message: "Route not found" });
  });

  test("an unknown POST route returns a JSON 404", async () => {
    const res = await request(app).post("/api/auth/unknown").send({});
    assert.equal(res.status, 404);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.deepEqual(res.body, { message: "Route not found" });
  });

  test("a path outside /api also returns a JSON 404", async () => {
    const res = await request(app).get("/nothing-here");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { message: "Route not found" });
  });
});

describe("JSON errors", () => {
  test("malformed JSON returns a JSON 400", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": "a@b.com", "password": ');
    assert.equal(res.status, 400);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.deepEqual(res.body, { message: "Invalid JSON in request body" });
  });

  test("a body that is too large returns a JSON 413", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ email: "a@b.com", password: "x".repeat(200 * 1024) }));
    assert.equal(res.status, 413);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.equal(typeof res.body.message, "string");
  });

  test("an unexpected error returns a generic 500 and leaks nothing", () => {
    const logged = mock.method(console, "error", () => {});
    const sent = {};
    const res = {
      headersSent: false,
      status(code) {
        sent.status = code;
        return this;
      },
      json(body) {
        sent.body = body;
        return this;
      },
    };

    try {
      const error = new Error("secret database detail: mongodb://user:pass@host");
      errorHandler(error, {}, res, () => assert.fail("next must not be called"));
    } finally {
      logged.mock.restore();
    }

    assert.equal(sent.status, 500);
    assert.deepEqual(sent.body, { message: "Server error" });
    assert.equal(JSON.stringify(sent.body).includes("secret"), false);
    assert.equal(logged.mock.callCount(), 1); // the details stay in the server log
  });

  test("an error after the response has started is passed on to Express", () => {
    let passed = null;
    const error = new Error("late error");
    errorHandler(error, {}, { headersSent: true }, (e) => {
      passed = e;
    });
    assert.equal(passed, error);
  });
});