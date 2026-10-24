import { describe, test, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { startTestDb, clearTestDb, stopTestDb } from "./helpers.js";
import app from "../src/app.js";
import Project from "../src/models/Project.js";
import Task from "../src/models/Task.js";
import Activity from "../src/models/Activity.js";

// Everything below is created through the real routes.

const createUser = async (name) => {
  const email = `${name}@example.com`;
  const password = "password123";
  const registered = await request(app).post("/api/auth/register").send({ name, email, password });
  assert.equal(registered.status, 201, "test setup: register should succeed");
  const login = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(login.status, 200, "test setup: login should succeed");
  return { id: registered.body.id, token: login.body.token };
};

const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const createProject = async (user, name) => {
  const res = await request(app).post("/api/projects").set(auth(user)).send({ name });
  assert.equal(res.status, 201, "test setup: create project should succeed");
  return res.body.project;
};

const createTask = async (user, projectId, title) => {
  const res = await request(app)
    .post(`/api/projects/${projectId}/tasks`)
    .set(auth(user))
    .send({ title });
  assert.equal(res.status, 201, "test setup: create task should succeed");
  return res.body.task;
};

const deleteProject = (user, projectId) =>
  request(app).delete(`/api/projects/${projectId}`).set(auth(user));

describe("deleting a project", () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(clearTestDb);

  test("deletes the project's tasks and activity, and nothing else", async () => {
    const alice = await createUser("alice");
    const doomed = await createProject(alice, "Doomed");
    const kept = await createProject(alice, "Kept");
    await createTask(alice, doomed._id, "Doomed task 1");
    await createTask(alice, doomed._id, "Doomed task 2");
    const keptTask = await createTask(alice, kept._id, "Kept task");

    // Setup sanity: the data really exists before the delete
    assert.equal(await Task.countDocuments({ project: doomed._id }), 2);
    assert.ok((await Activity.countDocuments({ project: doomed._id })) > 0);

    const res = await deleteProject(alice, doomed._id);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { message: "Project deleted" });

    assert.equal(await Project.countDocuments({ _id: doomed._id }), 0);
    assert.equal(await Task.countDocuments({ project: doomed._id }), 0);
    assert.equal(await Activity.countDocuments({ project: doomed._id }), 0);

    // The other project and its task are untouched
    assert.equal(await Project.countDocuments({ _id: kept._id }), 1);
    assert.equal(await Task.countDocuments({ _id: keptTask._id }), 1);
    assert.ok((await Activity.countDocuments({ project: kept._id })) > 0);
  });

  test("a second delete of the same project returns 404", async () => {
    const alice = await createUser("alice");
    const project = await createProject(alice, "Once");
    await createTask(alice, project._id, "Task");

    assert.equal((await deleteProject(alice, project._id)).status, 200);
    const again = await deleteProject(alice, project._id);
    assert.equal(again.status, 404);
    assert.deepEqual(again.body, { message: "Project not found" });
  });

  test("another user cannot delete the project or its tasks", async () => {
    const alice = await createUser("alice");
    const mallory = await createUser("mallory");
    const project = await createProject(alice, "Alice's project");
    await createTask(alice, project._id, "Alice's task");

    const res = await deleteProject(mallory, project._id);
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { message: "Project not found" });

    // Nothing was deleted
    assert.equal(await Project.countDocuments({ _id: project._id }), 1);
    assert.equal(await Task.countDocuments({ project: project._id }), 1);

    // And Alice can still use it
    const list = await request(app).get(`/api/projects/${project._id}/tasks`).set(auth(alice));
    assert.equal(list.status, 200);
    assert.equal(list.body.tasks.length, 1);
  });

  test("an unauthenticated request deletes nothing", async () => {
    const alice = await createUser("alice");
    const project = await createProject(alice, "Protected");
    await createTask(alice, project._id, "Task");

    const res = await request(app).delete(`/api/projects/${project._id}`);
    assert.equal(res.status, 401);
    assert.equal(await Project.countDocuments({ _id: project._id }), 1);
    assert.equal(await Task.countDocuments({ project: project._id }), 1);
  });

  test("an invalid project id returns 400 and deletes nothing", async () => {
    const alice = await createUser("alice");
    const project = await createProject(alice, "Safe");
    await createTask(alice, project._id, "Task");

    const res = await deleteProject(alice, "not-an-id");
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { message: "Invalid project ID" });
    assert.equal(await Task.countDocuments({ project: project._id }), 1);
  });

  test("if deleting the tasks fails, the project is kept and the error is JSON", async () => {
    const alice = await createUser("alice");
    const project = await createProject(alice, "Keep me");
    await createTask(alice, project._id, "Task");

    const failing = mock.method(Task, "deleteMany", async () => {
      throw new Error("simulated failure");
    });
    const logged = mock.method(console, "error", () => {});
    let res;
    try {
      res = await deleteProject(alice, project._id);
    } finally {
      failing.mock.restore();
      logged.mock.restore();
    }

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { message: "Server error" });

    // The project and its task are still there, so the delete can be repeated
    assert.equal(await Project.countDocuments({ _id: project._id }), 1);
    assert.equal(await Task.countDocuments({ project: project._id }), 1);

    const retry = await deleteProject(alice, project._id);
    assert.equal(retry.status, 200);
    assert.equal(await Task.countDocuments({ project: project._id }), 0);
  });
});