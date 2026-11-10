import type { ProjectRecord } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type { ProjectPick } from '../../../shared/modals/ProjectPickerModal';
import type { FeatureHost } from '../../FeatureHost';
import type { ProjectListActions } from './ProjectSections';

export interface ProjectActionsDeps {
  host: Pick<
    FeatureHost,
    | 'createProject'
    | 'deleteProject'
    | 'getConversationList'
    | 'getProjects'
    | 'renameProject'
    | 'setConversationProject'
    | 'setProjectPinned'
  >;
  /** Streaming or live background work in any open tab. */
  isConversationRunning(conversationId: string): boolean;
  archiveConversations(conversationIds: readonly string[]): Promise<void>;
  /** Opens a fresh draft tab; its state receives the project before the first send. */
  openDraft(): Promise<{ state: { draftProjectId: string | null } } | null>;
  promptName(initialName?: string): Promise<string | null>;
  pickProject(projects: readonly ProjectRecord[]): Promise<ProjectPick | null>;
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
}

/** Project operations behind the session list (+, ⋯ menu, conversation row menu). */
export class ProjectActions implements ProjectListActions {
  constructor(private readonly deps: ProjectActionsDeps) {}

  async createProject(): Promise<ProjectRecord | null> {
    const name = await this.deps.promptName();
    return name ? this.deps.host.createProject(name) : null;
  }

  async renameProject(projectId: string): Promise<void> {
    const project = this.find(projectId);
    if (!project) return;
    const name = await this.deps.promptName(project.name);
    if (name) await this.deps.host.renameProject(projectId, name);
  }

  setProjectPinned(projectId: string, isPinned: boolean): Promise<void> {
    return this.deps.host.setProjectPinned(projectId, isPinned);
  }

  async chooseProjectFor(conversationId: string): Promise<void> {
    const pick = await this.deps.pickProject(this.deps.host.getProjects());
    if (!pick) return;
    const projectId = pick.kind === 'new'
      ? (await this.createProject())?.id
      : pick.projectId;
    if (projectId) await this.moveToProject(conversationId, projectId);
  }

  moveToProject(conversationId: string, projectId: string | null): Promise<void> {
    return this.deps.host.setConversationProject(conversationId, projectId);
  }

  /** The only path that starts a conversation inside a project (R9). */
  async startProjectConversation(projectId: string): Promise<void> {
    if (!this.find(projectId)) {
      throw new Error('Project no longer exists');
    }
    const draft = await this.deps.openDraft();
    if (!draft) {
      throw new Error('Failed to create a provisional chat tab');
    }
    draft.state.draftProjectId = projectId;
  }

  /** Archives the project's listed sessions, skips running ones; the project stays. */
  async archiveProject(projectId: string): Promise<void> {
    // Individually pinned sessions render in Pinned, not in the project, so they are left alone.
    const members = this.deps.host.getConversationList().filter(conversation => (
      conversation.projectId === projectId && !conversation.isArchived && !conversation.isPinned
    ));
    const archivable = members
      .filter(conversation => !this.deps.isConversationRunning(conversation.id))
      .map(conversation => conversation.id);
    if (archivable.length > 0) {
      await this.deps.archiveConversations(archivable);
    }
    this.deps.notify(t('chat.projects.archived', {
      count: archivable.length,
      skipped: members.length - archivable.length,
    }));
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = this.find(projectId);
    if (!project) return;
    const confirmed = await this.deps.confirm(
      t('chat.projects.deleteConfirm', { name: project.name }),
    );
    if (confirmed) await this.deps.host.deleteProject(projectId);
  }

  private find(projectId: string): ProjectRecord | null {
    return this.deps.host.getProjects().find(project => project.id === projectId) ?? null;
  }
}
