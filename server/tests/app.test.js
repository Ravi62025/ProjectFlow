import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import "./helpers.js"; // sets the test environment only; it does not connect
import app from "../src/app.js";

test("importing the app does not connect to a database", () => {
  // 0 = disconnected
  assert.equal(mongoose.connection.readyState, 0);
});

test("the app is an Express application that is not listening", () => {
  assert.equal(typeof app, "function");
  assert.equal(typeof app.listen, "function");
});

test("GET /api/health responds without a database", async () => {
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { message: "ProjectFlow API is running" });
});