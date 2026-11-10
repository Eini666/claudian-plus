import { randomUUID } from 'node:crypto';

import type { ClaudianSettings, ProjectRecord } from '../../core/types';
import type { SettingsCoordinator } from '../settings/SettingsCoordinator';

export interface ProjectConversationRepository {
  list(): ReadonlyArray<{ id: string; projectId?: string }>;
  setProject(id: string, projectId: string | null): Promise<void>;
}

export interface ProjectStoreDeps {
  settingsCoordinator: SettingsCoordinator<ClaudianSettings>;
  getSettings: () => ClaudianSettings;
  repository: ProjectConversationRepository;
  createId?: () => string;
  now?: () => number;
}

/** Project list lives in settings; membership lives on each conversation (`projectId`). */
export class ProjectStore {
  private readonly createId: () => string;
  private readonly now: () => number;

  constructor(private readonly deps: ProjectStoreDeps) {
    this.createId = deps.createId ?? randomUUID;
    this.now = deps.now ?? Date.now;
  }

  list(): ProjectRecord[] {
    return this.deps.getSettings().projects ?? [];
  }

  get(id: string): ProjectRecord | null {
    return this.list().find(project => project.id === id) ?? null;
  }

  /** Conversation membership resolves only through a live project (missing project = no project). */
  resolve(projectId: string | undefined): ProjectRecord | null {
    return projectId ? this.get(projectId) : null;
  }

  /** Returns null for a blank name. */
  async create(name: string): Promise<ProjectRecord | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const project: ProjectRecord = { id: this.createId(), name: trimmed, createdAt: this.now() };
    await this.deps.settingsCoordinator.mutate((settings) => {
      settings.projects = [...(settings.projects ?? []), project];
    });
    return project;
  }

  rename(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve(false);
    return this.updateProject(id, project => (
      project.name === trimmed ? null : { ...project, name: trimmed }
    ));
  }

  setPinned(id: string, isPinned: boolean): Promise<boolean> {
    return this.updateProject(id, (project) => {
      if ((project.isPinned ?? false) === isPinned) return null;
      const { isPinned: _previous, ...rest } = project;
      return isPinned ? { ...rest, isPinned: true } : rest;
    });
  }

  /** Removes the record and clears `projectId` on its conversations (they return to Sessions). */
  async delete(id: string): Promise<boolean> {
    let changed = false;
    await this.deps.settingsCoordinator.mutateConditionally((settings) => {
      const current = settings.projects ?? [];
      const retained = current.filter(project => project.id !== id);
      changed = retained.length !== current.length;
      if (changed) settings.projects = retained;
      return changed;
    });
    if (!changed) return false;

    const members = this.deps.repository.list().filter(conversation => conversation.projectId === id);
    await Promise.all(members.map(conversation => this.deps.repository.setProject(conversation.id, null)));
    return true;
  }

  private async updateProject(
    id: string,
    update: (project: ProjectRecord) => ProjectRecord | null,
  ): Promise<boolean> {
    let changed = false;
    await this.deps.settingsCoordinator.mutateConditionally((settings) => {
      const current = settings.projects ?? [];
      const index = current.findIndex(project => project.id === id);
      if (index === -1) return false;
      const next = update(current[index]);
      if (!next) return false;

      settings.projects = current.map((project, i) => (i === index ? next : project));
      changed = true;
      return true;
    });
    return changed;
  }
}
