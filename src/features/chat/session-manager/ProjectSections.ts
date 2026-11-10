import { Menu, Notice, setIcon } from 'obsidian';

import type { ConversationMeta } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { makeDropTarget } from './SessionDragDrop';
import type { SessionListSection } from './SessionListOrganizer';

/** Project actions the session list can trigger (implemented by `ProjectActions`). */
export interface ProjectListActions {
  createProject(): Promise<unknown>;
  startProjectConversation(projectId: string): Promise<void>;
  renameProject(projectId: string): Promise<void>;
  setProjectPinned(projectId: string, isPinned: boolean): Promise<void>;
  archiveProject(projectId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  chooseProjectFor(conversationId: string): Promise<void>;
  moveToProject(conversationId: string, projectId: string | null): Promise<void>;
}

export interface ProjectSectionContext {
  projectActions: ProjectListActions;
  collapsedGroupKeys?: ReadonlySet<string>;
  onGroupCollapseChange?: (groupKey: string, collapsed: boolean) => void;
  onRerender: () => void;
  /** Current project of a conversation; lets a drop onto its own project do nothing. */
  projectIdOf?: (conversationId: string) => string | null | undefined;
  renderConversation: (parent: HTMLElement, conversation: ConversationMeta) => void;
}

function runProjectAction(action: () => Promise<unknown>): void {
  void action().catch((error: unknown) => {
    new Notice(`Project action failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function bindActivate(
  el: HTMLElement,
  action: (event?: MouseEvent) => void,
  stopPropagation: boolean,
): void {
  el.addEventListener('click', (event) => {
    if (stopPropagation) event.stopPropagation();
    action(event);
  });
  el.addEventListener('keydown', (event) => {
    if (stopPropagation) event.stopPropagation();
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
  });
}

function createActionButton(
  parent: HTMLElement,
  cls: string,
  icon: string,
  label: string,
  action: (event?: MouseEvent) => void,
): HTMLElement {
  const button = parent.createSpan({ cls });
  button.setAttribute('role', 'button');
  button.setAttribute('tabindex', '0');
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  setIcon(button, icon);
  bindActivate(button, action, true);
  return button;
}

/** "Projects" section between Pinned and Sessions; the header + stays reachable with zero projects. */
export function renderProjectsSection(
  list: HTMLElement,
  sections: readonly SessionListSection[],
  context: ProjectSectionContext,
): void {
  const section = list.createDiv({
    cls: 'claudian-history-section claudian-history-section--projects',
  });
  const header = section.createDiv({
    cls: 'claudian-history-header claudian-session-section-header',
  });
  header.createSpan({
    cls: 'claudian-history-section-label',
    text: t('chat.projects.section'),
  });
  const actions = header.createDiv({ cls: 'claudian-session-header-actions' });
  const newButton = actions.createDiv({ cls: 'claudian-session-header-btn claudian-project-new-btn' });
  newButton.setAttribute('role', 'button');
  newButton.setAttribute('tabindex', '0');
  newButton.setAttribute('aria-label', t('chat.projects.new'));
  newButton.setAttribute('title', t('chat.projects.new'));
  setIcon(newButton.createDiv({ cls: 'claudian-session-header-icon' }), 'plus');
  bindActivate(newButton, () => runProjectAction(() => context.projectActions.createProject()), false);

  const items = section.createDiv({ cls: 'claudian-history-section-items' });
  for (const projectSection of sections) {
    renderProjectGroup(items, projectSection, false, context);
  }
}

/** One project row (chevron, name, count, +, ⋯) and its conversations. */
export function renderProjectGroup(
  parent: HTMLElement,
  section: SessionListSection,
  isPinned: boolean,
  context: ProjectSectionContext,
): void {
  const projectId = section.projectId ?? '';
  const { projectActions } = context;
  const isCollapsed = context.collapsedGroupKeys?.has(section.key) ?? false;

  const header = parent.createDiv({
    cls: 'claudian-session-group-header claudian-session-group-header--project',
  });
  header.setAttribute('data-group-kind', 'project');
  header.setAttribute('data-project-id', projectId);
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  setIcon(
    header.createSpan({ cls: 'claudian-session-group-icon claudian-project-chevron' }),
    isCollapsed ? 'chevron-right' : 'chevron-down',
  );
  header.createSpan({ cls: 'claudian-session-group-label', text: section.label ?? '' });
  header.createSpan({
    cls: 'claudian-session-group-count',
    text: String(section.conversations.length),
  });

  const startConversation = (): void => runProjectAction(
    () => projectActions.startProjectConversation(projectId),
  );
  const showMenu = (event?: MouseEvent): void => {
    const menu = new Menu().setUseNativeMenu(false);
    menu.addItem(item => item
      .setTitle(t('chat.projects.newSession'))
      .onClick(startConversation));
    menu.addItem(item => item
      .setTitle(isPinned ? t('chat.projects.unpin') : t('chat.projects.pin'))
      .onClick(() => runProjectAction(() => projectActions.setProjectPinned(projectId, !isPinned))));
    menu.addItem(item => item
      .setTitle(t('chat.projects.rename'))
      .onClick(() => runProjectAction(() => projectActions.renameProject(projectId))));
    menu.addSeparator();
    menu.addItem(item => item
      .setTitle(t('chat.projects.archiveAll'))
      .onClick(() => runProjectAction(() => projectActions.archiveProject(projectId))));
    menu.addItem(item => item
      .setTitle(t('chat.projects.delete'))
      .setWarning(true)
      .onClick(() => runProjectAction(() => projectActions.deleteProject(projectId))));
    if (event) {
      menu.showAtMouseEvent(event);
      return;
    }
    const rect = header.getBoundingClientRect();
    menu.showAtPosition({ x: rect.right, y: rect.bottom }, header.ownerDocument);
  };

  createActionButton(
    header,
    'claudian-session-group-new-action',
    'plus',
    t('chat.projects.newSession'),
    startConversation,
  );
  createActionButton(
    header,
    'claudian-session-group-new-action claudian-project-menu-action',
    'ellipsis',
    'Project options',
    showMenu,
  );
  header.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showMenu(event);
  });
  makeDropTarget(
    header,
    conversationId => runProjectAction(() => projectActions.moveToProject(conversationId, projectId)),
    conversationId => context.projectIdOf?.(conversationId) === projectId,
  );
  bindActivate(header, () => {
    context.onGroupCollapseChange?.(section.key, !isCollapsed);
    context.onRerender();
  }, false);

  const body = parent.createDiv({
    cls: [
      'claudian-session-group-body',
      isCollapsed ? 'claudian-session-group-body--collapsed' : '',
    ].filter(Boolean).join(' '),
  });
  body.setAttribute('data-group-key', section.key);
  if (isCollapsed) return;

  if (section.conversations.length === 0) {
    body.createDiv({ cls: 'claudian-session-group-empty', text: t('chat.projects.empty') });
    return;
  }
  for (const conversation of section.conversations) {
    context.renderConversation(body, conversation);
  }
}
