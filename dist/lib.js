const INPUT_PREFIX = "INPUT_";

function inputKey(name) {
  return `${INPUT_PREFIX}${name.replace(/ /g, "_").replace(/-/g, "_").toUpperCase()}`;
}

function getInput(name, options = {}) {
  const value = process.env[inputKey(name)] ?? "";
  const trimmed = value.trim();

  if (!trimmed && options.required) {
    throw new Error(`Missing required input: ${name}`);
  }

  if (!trimmed && options.defaultValue !== undefined) {
    return options.defaultValue;
  }

  return trimmed;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parseList(value) {
  return String(value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function renderTemplate(template, context) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function escapeDescriptionBlock(value) {
  return String(value ?? "").trim();
}

function sourceMarker(item) {
  return `Source: github://${item.repo}/${item.type}/${item.number}`;
}

function buildTaskContent(item, template) {
  return renderTemplate(template, item).trim();
}

function buildTaskDescription(item, template) {
  const base = escapeDescriptionBlock(renderTemplate(template, item));
  return [base, sourceMarker(item)].filter(Boolean).join("\n\n");
}

function normalizeGitHubItem(raw, repo) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Cannot normalize an empty GitHub item.");
  }

  const isPullRequest = Boolean(raw.pull_request) || String(raw.html_url || "").includes("/pull/");
  const type = isPullRequest ? "pull-request" : "issue";

  return {
    repo,
    type,
    kind: isPullRequest ? "PR" : "Issue",
    number: raw.number,
    title: raw.title ?? "",
    url: raw.html_url ?? "",
    state: raw.state ?? "",
    author: raw.user?.login ?? "",
    assignees: Array.isArray(raw.assignees) ? raw.assignees.map((assignee) => assignee.login).join(", ") : ""
  };
}

function taskMatchesItem(task, item) {
  const marker = sourceMarker(item);
  const description = String(task?.description ?? "");
  return description.includes(marker);
}

function sortItems(items) {
  return [...items].sort((left, right) => Number(left.number) - Number(right.number));
}

module.exports = {
  buildTaskContent,
  buildTaskDescription,
  getInput,
  normalizeGitHubItem,
  parseBoolean,
  parseList,
  renderTemplate,
  sortItems,
  sourceMarker,
  taskMatchesItem
};
