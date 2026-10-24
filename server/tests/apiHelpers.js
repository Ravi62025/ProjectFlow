import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Project from "../src/models/Project.js";
import Task from "../src/models/Task.js";
import Activity from "../src/models/Activity.js";

// Shared by the authorization tests. Everything goes through the real routes.
// This file has no tests of its own and does not start a database.

export const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

// Registers and logs in a user through the real auth routes
export const createUser = async (name) => {
  const email = `${name}@example.com`;
  const password = "password123";
  const registered = await request(app).post("/api/auth/register").send({ name, email, password });
  assert.equal(registered.status, 201, "test setup: register should succeed");
  const login = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(login.status, 200, "test setup: login should succeed");
  return { id: registered.body.id, name, token: login.body.token };
};

export const createProject = async (user, name) => {
  const res = await request(app).post("/api/projects").set(auth(user)).send({ name });
  assert.equal(res.status, 201, "test setup: create project should succeed");
  return res.body.project;
};

export const createTask = async (user, projectId, fields) => {
  const res = await request(app)
    .post(`/api/projects/${projectId}/tasks`)
    .set(auth(user))
    .send(fields);
  assert.equal(res.status, 201, "test setup: create task should succeed");
  return res.body.task;
};

// Sends a request with the real app. `user` is optional (no token when omitted).
export const send = (method, path, { user, body } = {}) => {
  let req = request(app)[method](path);
  if (user) req = req.set(auth(user));
  if (body !== undefined) req = req.send(body);
  return req;
};

// A string describing everything stored in the database, in a stable order.
// Comparing two snapshots shows whether anything at all was created, changed or deleted
// (updatedAt is included, so even an update that changes nothing visible is detected).
export const snapshotDb = async () => {
  const read = (Model) => Model.find().sort({ _id: 1 }).lean();
  const [users, projects, tasks, activities] = await Promise.all([
    read(User),
    read(Project),
    read(Task),
    read(Activity),
  ]);
  return JSON.stringify({ users, projects, tasks, activities });
};