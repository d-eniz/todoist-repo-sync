const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTaskContent,
  buildTaskDescription,
  getInput,
  normalizeGitHubItem,
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
    url: "https://github.com/octo/example/issues/42"
  };

  assert.equal(
    buildTaskDescription(item, "{{url}}"),
    "https://github.com/octo/example/issues/42\n\nSource: github://octo/example/issue/42"
  );
});

test("taskMatchesItem matches Todoist tasks by marker", () => {
  const item = {
    repo: "octo/example",
    type: "pull-request",
    number: 7
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
