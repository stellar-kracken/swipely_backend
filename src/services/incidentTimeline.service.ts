export interface TimelineEvent {
  id: string;
  incidentId: string;
  type: string;
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt: string;
}

export class IncidentTimelineService {
  private readonly store = new Map<string, TimelineEvent[]>();

  async addEvent(incidentId: string, event: Omit<TimelineEvent, "id" | "incidentId">) {
    const item: TimelineEvent = {
      id: `${incidentId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      incidentId,
      type: event.type,
      actor: event.actor ?? null,
      metadata: event.metadata ?? null,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
    };
    const list = this.store.get(incidentId) ?? [];
    list.push(item);
    this.store.set(incidentId, list);
    return item;
  }

  async getTimeline(incidentId: string) {
    const list = this.store.get(incidentId) ?? [];
    return list.slice().sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  async listAll() {
    const entries: Record<string, TimelineEvent[]> = {};
    for (const [k, v] of this.store.entries()) entries[k] = v;
    return entries;
  }
}

export const incidentTimelineService = new IncidentTimelineService();
