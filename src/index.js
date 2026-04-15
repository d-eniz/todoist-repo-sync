const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  buildReminderDateTime,
  buildTaskContent,
  buildTaskDescription,
  getInput,
  normalizeGitHubItem,
  parseSectionSpec,
  parsePriority,
  parseBoolean,
  parseList,
  sortItems,
  taskMatchesItem
} = require("./lib");

const TODOIST_BASE_URL = "https://api.todoist.com/api/v1";

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  fs.appendFileSync(outputPath, `${name}<<__EOF__\n${serialized}\n__EOF__\n`);
}

function info(message) {
  console.log(message);
}

function setFailed(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  console.error(error);
  process.exitCode = 1;
}

function isPremiumOnlyReminderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("PREMIUM_ONLY") || message.includes("Premium only feature");
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON response from ${response.url}, received: ${text}`);
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await readJsonResponse(response);

  if (!response.ok) {
    const detail = data?.error || data?.message || JSON.stringify(data);
    throw new Error(`Request failed (${response.status}) for ${url}: ${detail}`);
  }

  return data;
}

function todoistHeaders(token, includeJson = false) {
  const headers = {
    Authorization: `Bearer ${token}`
  };

  if (includeJson) {
    headers["Content-Type"] = "application/json";
    headers["X-Request-Id"] = crypto.randomUUID();
  }

  return headers;
}

async function listTodoistTasks(todoistToken, projectId) {
  const url = new URL(`${TODOIST_BASE_URL}/tasks`);
  url.searchParams.set("project_id", projectId);
  const tasks = await requestJson(url, {
    headers: todoistHeaders(todoistToken)
  });
  if (Array.isArray(tasks)) {
    return tasks;
  }
  if (Array.isArray(tasks?.results)) {
    return tasks.results;
  }
  return [];
}

async function createTodoistTask(todoistToken, payload) {
  return requestJson(`${TODOIST_BASE_URL}/tasks`, {
    method: "POST",
    headers: todoistHeaders(todoistToken, true),
    body: JSON.stringify(payload)
  });
}

async function listTodoistSections(todoistToken, projectId) {
  const url = new URL(`${TODOIST_BASE_URL}/sections`);
  url.searchParams.set("project_id", projectId);
  const sections = await requestJson(url, {
    headers: todoistHeaders(todoistToken)
  });

  if (Array.isArray(sections)) {
    return sections;
  }
  if (Array.isArray(sections?.results)) {
    return sections.results;
  }
  return [];
}

async function updateTodoistTask(todoistToken, taskId, payload) {
  return requestJson(`${TODOIST_BASE_URL}/tasks/${taskId}`, {
    method: "POST",
    headers: todoistHeaders(todoistToken, true),
    body: JSON.stringify(payload)
  });
}

async function createTodoistReminder(todoistToken, taskId, reminderDateTime) {
  const uuid = crypto.randomUUID();
  const tempId = crypto.randomUUID();
  const body = new URLSearchParams({
    sync_token: "*",
    resource_types: JSON.stringify(["reminders"]),
    commands: JSON.stringify([
      {
        type: "reminder_add",
        temp_id: tempId,
        uuid,
        args: {
          item_id: String(taskId),
          type: "absolute",
          due: {
            date: reminderDateTime
          }
        }
      }
    ])
  });

  const response = await requestJson(`${TODOIST_BASE_URL}/sync`, {
    method: "POST",
    headers: todoistHeaders(todoistToken),
    body
  });
  const syncStatus = response?.sync_status?.[uuid];

  if (syncStatus !== "ok") {
    throw new Error(`Failed to create Todoist reminder for task ${taskId}: ${JSON.stringify(syncStatus)}`);
  }
}

async function resolveSectionId(todoistToken, projectId, defaultSection) {
  const sectionSpec = parseSectionSpec(defaultSection, projectId);
  if (!sectionSpec) {
    return null;
  }

  if (sectionSpec.projectId && sectionSpec.projectId !== String(projectId)) {
    throw new Error(
      `Default section project ID "${sectionSpec.projectId}" does not match configured Todoist project "${projectId}".`
    );
  }

  const sections = await listTodoistSections(todoistToken, projectId);
  const matchedSection = sections.find(
    (section) => String(section?.name ?? "").trim().toLowerCase() === sectionSpec.sectionName.toLowerCase()
  );

  if (!matchedSection) {
    throw new Error(`Todoist section "${sectionSpec.sectionName}" not found in project ${projectId}.`);
  }

  return matchedSection.id;
}

function githubHeaders(githubToken) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "User-Agent": "todoist-repo-sync-action"
  };
}

async function fetchOpenIssuesAndPullRequests(githubToken, repo, apiUrl) {
  const items = [];
  let page = 1;

  while (true) {
    const url = new URL(`${apiUrl}/repos/${repo}/issues`);
    url.searchParams.set("state", "open");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const pageItems = await requestJson(url, {
      headers: githubHeaders(githubToken)
    });

    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }

    items.push(...pageItems);

    if (pageItems.length < 100) {
      break;
    }

    page += 1;
  }

  return items;
}

function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set.");
  }

  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

function resolveMode(requestedMode, eventName) {
  if (requestedMode === "event" || requestedMode === "backfill") {
    return requestedMode;
  }

  if (requestedMode !== "auto") {
    throw new Error(`Unsupported mode: ${requestedMode}`);
  }

  if (eventName === "issues" || eventName === "pull_request") {
    return "event";
  }

  if (eventName === "schedule" || eventName === "workflow_dispatch") {
    return "backfill";
  }

  throw new Error(`auto mode does not support the "${eventName}" event.`);
}

function shouldIncludeItem(item, options) {
  if (item.type === "issue" && !options.includeIssues) {
    return false;
  }

  if (item.type === "pull-request" && !options.includePullRequests) {
    return false;
  }

  return true;
}

function getEventItem(payload, eventName, repo) {
  if (eventName === "issues") {
    return normalizeGitHubItem(payload.issue, repo);
  }

  if (eventName === "pull_request") {
    return normalizeGitHubItem(payload.pull_request, repo);
  }

  throw new Error(`Unsupported event item source: ${eventName}`);
}

async function getItemsForRun(mode, eventName, payload, options) {
  if (mode === "event") {
    const action = String(payload.action || "");
    if (!options.allowedActions.includes(action)) {
      info(`Skipping event action "${action}" because it is not in allowed-actions.`);
      return [];
    }

    return [getEventItem(payload, eventName, options.repo)].filter((item) => shouldIncludeItem(item, options));
  }

  const rawItems = await fetchOpenIssuesAndPullRequests(options.githubToken, options.repo, options.githubApiUrl);
  const normalized = rawItems.map((item) => normalizeGitHubItem(item, options.repo));
  return sortItems(normalized).filter((item) => shouldIncludeItem(item, options));
}

async function syncItems(items, options) {
  const stats = {
    createdCount: 0,
    skippedCount: 0,
    processedCount: items.length,
    createdTaskIds: []
  };

  if (items.length === 0) {
    return stats;
  }

  let existingTasks = [];
  if (options.skipDuplicates) {
    existingTasks = await listTodoistTasks(options.todoistToken, options.todoistProjectId);
  }

  const sectionId = options.defaultSection
    ? await resolveSectionId(options.todoistToken, options.todoistProjectId, options.defaultSection)
    : null;

  for (const item of items) {
    const content = buildTaskContent(item, options.taskTemplate);
    const description = buildTaskDescription(item, options.descriptionTemplate);

    if (options.skipDuplicates && existingTasks.some((task) => taskMatchesItem(task, item))) {
      info(`Skipping ${item.kind} #${item.number}; matching Todoist task already exists.`);
      stats.skippedCount += 1;
      continue;
    }

    const createdTask = await createTodoistTask(options.todoistToken, {
      content,
      description,
      project_id: options.todoistProjectId,
      priority: options.defaultPriority,
      ...(sectionId ? { section_id: sectionId } : {})
    });

    if (options.addReminder) {
      const reminderDateTime = buildReminderDateTime();
      try {
        await createTodoistReminder(options.todoistToken, createdTask.id, reminderDateTime);
        info(`Created Todoist reminder for task ${createdTask.id} at ${reminderDateTime}.`);
      } catch (error) {
        if (!options.fallbackTimeDate || !isPremiumOnlyReminderError(error)) {
          throw error;
        }

        await updateTodoistTask(options.todoistToken, createdTask.id, {
          due_datetime: reminderDateTime
        });
        info(
          `Reminder premium-only for task ${createdTask.id}; applied due_datetime fallback at ${reminderDateTime}.`
        );
      }
    }

    info(`Created Todoist task ${createdTask.id} for ${item.kind} #${item.number}.`);
    stats.createdCount += 1;
    stats.createdTaskIds.push(createdTask.id);
    existingTasks.push(createdTask);
  }

  return stats;
}

async function main() {
  const payload = readEventPayload();
  const eventName = process.env.GITHUB_EVENT_NAME;
  const repo = process.env.GITHUB_REPOSITORY;

  if (!eventName) {
    throw new Error("GITHUB_EVENT_NAME is not set.");
  }

  if (!repo) {
    throw new Error("GITHUB_REPOSITORY is not set.");
  }

  const options = {
    todoistToken: getInput("todoist-token", { required: true, fallbackEnv: ["TODOIST_TOKEN"] }),
    todoistProjectId: getInput("todoist-project-id", { required: true, fallbackEnv: ["TODOIST_PROJECT_ID"] }),
    githubToken: getInput("github-token", { fallbackEnv: ["GITHUB_TOKEN"] }),
    mode: getInput("mode", { defaultValue: "auto" }),
    allowedActions: parseList(getInput("allowed-actions", { defaultValue: "opened,reopened,assigned" })),
    includeIssues: parseBoolean(getInput("include-issues", { defaultValue: "true" }), true),
    includePullRequests: parseBoolean(getInput("include-pull-requests", { defaultValue: "true" }), true),
    skipDuplicates: parseBoolean(getInput("skip-duplicates", { defaultValue: "true" }), true),
    defaultPriority: parsePriority(getInput("default-priority", { defaultValue: "P4" })),
    addReminder: parseBoolean(getInput("add-reminder", { defaultValue: "false" }), false),
    fallbackTimeDate: parseBoolean(getInput("fallback-time-date", { defaultValue: "false" }), false),
    defaultSection: getInput("default-section"),
    taskTemplate: getInput("task-template", { defaultValue: "[{{repo}}] {{kind}} #{{number}}: {{title}}" }),
    descriptionTemplate: getInput("description-template", { defaultValue: "{{desc}}" }),
    repo,
    githubApiUrl: process.env.GITHUB_API_URL || "https://api.github.com"
  };

  const mode = resolveMode(options.mode, eventName);
  if (mode === "backfill" && !options.githubToken) {
    throw new Error("github-token is required for backfill mode.");
  }

  const items = await getItemsForRun(mode, eventName, payload, options);
  const stats = await syncItems(items, options);

  setOutput("created-count", String(stats.createdCount));
  setOutput("skipped-count", String(stats.skippedCount));
  setOutput("processed-count", String(stats.processedCount));
  setOutput("created-task-ids", stats.createdTaskIds);

  info(
    `Finished ${mode} run. Processed ${stats.processedCount} item(s), created ${stats.createdCount}, skipped ${stats.skippedCount}.`
  );
}

main().catch(setFailed);
