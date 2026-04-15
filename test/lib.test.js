const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildReminderDateTime,
  buildTaskContent,
  buildTaskDescription,
  getInput,
  normalizeGitHubItem,
  parsePriority,
  parseBoolean,
  parseList,
  renderTemplate,
  sourceMarker,
  taskMatchesItem
} = require("../src/lib");

test("renderTemplate replaces placeholders with item values", () => {
  const rendered = renderTemplate("[{{repo}}] {{kind}} #{{number}}: {{title}}", {
    repo: "octo/example",
    kind: "Issue",
    number: 42,
    title: "Ship it"
  });

  assert.equal(rendered, "[octo/example] Issue #42: Ship it");
});

test("buildTaskDescription appends the GitHub source marker", () => {
  const item = {
    repo: "octo/example",
    type: "issue",
    number: 42,
    desc: "Investigate redirect loop",
    url: "https://github.com/octo/example/issues/42"
  };

  assert.equal(
    buildTaskDescription(item, "{{desc}}"),
    "Investigate redirect loop\n\nSource: https://github.com/octo/example/issues/42"
  );
});

test("taskMatchesItem matches Todoist tasks by marker", () => {
  const item = {
    repo: "octo/example",
    type: "pull-request",
    number: 7,
    url: "https://github.com/octo/example/pull/7"
  };

  assert.equal(
    taskMatchesItem(
      {
        description: `https://github.com/octo/example/pull/7\n\n${sourceMarker(item)}`
      },
      item
    ),
    true
  );
});

test("normalizeGitHubItem keeps issue and PR metadata consistent", () => {
  const issue = normalizeGitHubItem(
    {
      number: 10,
      title: "Bug report",
      html_url: "https://github.com/octo/example/issues/10",
      body: "Steps to reproduce",
      user: { login: "alice" },
      assignees: [{ login: "bob" }]
    },
    "octo/example"
  );
  const pullRequest = normalizeGitHubItem(
    {
      number: 11,
      title: "Fix bug",
      html_url: "https://github.com/octo/example/pull/11",
      body: "Patch details",
      pull_request: {},
      user: { login: "alice" },
      assignees: []
    },
    "octo/example"
  );

  assert.deepEqual(
    {
      repo: issue.repo,
      type: issue.type,
      kind: issue.kind,
      number: issue.number,
      title: issue.title,
      url: issue.url,
      desc: issue.desc,
      author: issue.author,
      assignees: issue.assignees
    },
    {
      repo: "octo/example",
      type: "issue",
      kind: "Issue",
      number: 10,
      title: "Bug report",
      url: "https://github.com/octo/example/issues/10",
      desc: "Steps to reproduce",
      author: "alice",
      assignees: "bob"
    }
  );

  assert.equal(pullRequest.type, "pull-request");
  assert.equal(pullRequest.kind, "PR");
});

test("parseBoolean and parseList handle action inputs", () => {
  assert.equal(parseBoolean("yes"), true);
  assert.equal(parseBoolean("off"), false);
  assert.deepEqual(parseList("opened,\nreopened, assigned"), ["opened", "reopened", "assigned"]);
});

test("buildTaskContent keeps the default title format", () => {
  const content = buildTaskContent(
    {
      repo: "octo/example",
      kind: "PR",
      number: 12,
      title: "Improve docs"
    },
    "[{{repo}}] {{kind}} #{{number}}: {{title}}"
  );

  assert.equal(content, "[octo/example] PR #12: Improve docs");
});

test("getInput falls back to env vars when action input is empty", () => {
  process.env.TODOIST_TOKEN = "secret-token";
  delete process.env.INPUT_TODOIST_TOKEN;

  assert.equal(getInput("todoist-token", { required: true, fallbackEnv: ["TODOIST_TOKEN"] }), "secret-token");

  delete process.env.TODOIST_TOKEN;
});

test("parsePriority maps P values to Todoist priority integers", () => {
  assert.equal(parsePriority("P1"), 4);
  assert.equal(parsePriority("p2"), 3);
  assert.equal(parsePriority("P3"), 2);
  assert.equal(parsePriority("P4"), 1);
  assert.throws(() => parsePriority("urgent"), /Invalid priority/);
});

test("buildReminderDateTime sets reminder one minute ahead", () => {
  assert.equal(buildReminderDateTime(new Date("2026-04-15T10:00:00.000Z")), "2026-04-15T10:01:00.000000Z");
});
