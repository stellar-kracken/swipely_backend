import { readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

export interface PlaybookStep {
  order: number;
  title: string;
  body: string;
}

export interface AlertPlaybook {
  id: string;
  alertType: string;
  title: string;
  severity: string[];
  summary: string;
  steps: PlaybookStep[];
  tags: string[];
}

export interface PlaybookSearchResult {
  playbooks: AlertPlaybook[];
  total: number;
  query?: string;
}

const RUNBOOK_PATH = path.resolve(process.cwd(), "docs/ALERTING_RUNBOOK.md");

let cachedPlaybooks: AlertPlaybook[] | null = null;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function extractAlertType(section: string): string {
  const match = section.match(/\*\*Alert Type\*\*:\s*`([^`]+)`/i);
  return match?.[1] ?? slugify(section.split("\n")[0] ?? "playbook");
}

function extractSeverity(section: string): string[] {
  const match = section.match(/\*\*Typical Severity\*\*:\s*([^\n]+)/i);
  if (!match) return [];
  return match[1]
    .split("/")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function extractSteps(section: string): PlaybookStep[] {
  const lines = section.split("\n");
  const steps: PlaybookStep[] = [];
  let current: PlaybookStep | null = null;

  for (const line of lines) {
    const numbered = line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
    const numberedPlain = line.match(/^\d+\.\s+(.+)/);

    if (numbered) {
      if (current) steps.push(current);
      current = { order: steps.length + 1, title: numbered[1], body: "" };
      continue;
    }

    if (numberedPlain && !line.includes("```")) {
      if (current) steps.push(current);
      current = { order: steps.length + 1, title: numberedPlain[1], body: "" };
      continue;
    }

    if (current && line.trim() && !line.startsWith("#")) {
      current.body += `${line.trim()}\n`;
    }
  }

  if (current) steps.push(current);
  return steps;
}

export function parsePlaybooksFromMarkdown(markdown: string): AlertPlaybook[] {
  const sectionChunks = markdown.split(/\n###\s+/).slice(1);
  const playbooks: AlertPlaybook[] = [];

  for (const chunk of sectionChunks) {
    const section = `### ${chunk}`;
    const titleLine = chunk.split("\n")[0]?.trim() ?? "Alert playbook";
    const title = titleLine.replace(/^\d+\.\s*/, "");
    const alertType = extractAlertType(section);
    const steps = extractSteps(section);

    if (steps.length === 0) continue;

    const summary = chunk
      .split("\n")
      .find((line) => line.startsWith("**Description**:"))
      ?.replace("**Description**:", "")
      .trim() ?? `Remediation steps for ${title}`;

    playbooks.push({
      id: slugify(alertType || title),
      alertType,
      title,
      severity: extractSeverity(section),
      summary,
      steps,
      tags: [alertType, ...extractSeverity(section)],
    });
  }

  return playbooks;
}

export class PlaybookService {
  async loadPlaybooks(): Promise<AlertPlaybook[]> {
    if (cachedPlaybooks) return cachedPlaybooks;

    try {
      const markdown = await readFile(RUNBOOK_PATH, "utf8");
      cachedPlaybooks = parsePlaybooksFromMarkdown(markdown);
      return cachedPlaybooks;
    } catch (error) {
      logger.error({ error }, "Failed to load alerting runbook");
      cachedPlaybooks = [];
      return cachedPlaybooks;
    }
  }

  async listPlaybooks(): Promise<AlertPlaybook[]> {
    return this.loadPlaybooks();
  }

  async getPlaybook(idOrType: string): Promise<AlertPlaybook | null> {
    const playbooks = await this.loadPlaybooks();
    return (
      playbooks.find(
        (playbook) =>
          playbook.id === idOrType ||
          playbook.alertType === idOrType ||
          playbook.title.toLowerCase() === idOrType.toLowerCase(),
      ) ?? null
    );
  }

  async searchPlaybooks(query?: string, alertType?: string, severity?: string): Promise<PlaybookSearchResult> {
    const playbooks = await this.loadPlaybooks();
    const q = query?.trim().toLowerCase();

    const filtered = playbooks.filter((playbook) => {
      if (alertType && playbook.alertType !== alertType) return false;
      if (severity && !playbook.severity.includes(severity.toLowerCase())) return false;
      if (!q) return true;

      const haystack = [
        playbook.title,
        playbook.summary,
        playbook.alertType,
        ...playbook.tags,
        ...playbook.steps.map((step) => `${step.title} ${step.body}`),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });

    return { playbooks: filtered, total: filtered.length, query };
  }
}

export const playbookService = new PlaybookService();
