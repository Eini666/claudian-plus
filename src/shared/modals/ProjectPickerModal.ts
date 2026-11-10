import { type App, Modal, Setting, SuggestModal } from 'obsidian';

import type { ProjectRecord } from '../../core/types';
import { t } from '../../i18n/i18n';

export type ProjectPick = { kind: 'project'; projectId: string } | { kind: 'new' };

interface ProjectPickItem {
  label: string;
  pick: ProjectPick;
}

export function pickProject(
  app: App,
  projects: readonly ProjectRecord[],
): Promise<ProjectPick | null> {
  return new Promise(resolve => {
    new ProjectPickerModal(app, projects, resolve).open();
  });
}

export function promptProjectName(app: App, initialName = ''): Promise<string | null> {
  return new Promise(resolve => {
    new ProjectNameModal(app, initialName, resolve).open();
  });
}

class ProjectPickerModal extends SuggestModal<ProjectPickItem> {
  constructor(
    app: App,
    private readonly projects: readonly ProjectRecord[],
    private readonly resolve: (pick: ProjectPick | null) => void,
  ) {
    super(app);
    this.setPlaceholder(t('chat.projects.pickPlaceholder'));
  }

  getSuggestions(query: string): ProjectPickItem[] {
    const needle = query.trim().toLocaleLowerCase();
    return [
      ...this.projects
        .filter(project => project.name.toLocaleLowerCase().includes(needle))
        .map(project => ({
          label: project.name,
          pick: { kind: 'project', projectId: project.id } as const,
        })),
      { label: t('chat.projects.pickNew'), pick: { kind: 'new' } },
    ];
  }

  renderSuggestion(item: ProjectPickItem, el: HTMLElement): void {
    el.setText(item.label);
  }

  onChooseSuggestion(item: ProjectPickItem): void {
    this.resolve(item.pick);
  }

  onClose(): void {
    // Obsidian closes the modal before calling onChooseSuggestion; a pick resolves first, this is a no-op then.
    window.setTimeout(() => this.resolve(null), 0);
  }
}

class ProjectNameModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly initialName: string,
    private readonly resolve: (name: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('chat.projects.newNamePrompt'));
    this.modalEl.addClass('claudian-project-name-modal');

    const input = this.contentEl.createEl('input', {
      cls: 'claudian-project-name-input',
      attr: { type: 'text', 'aria-label': t('chat.projects.newNamePrompt') },
    });
    input.value = this.initialName;

    const submit = (): void => {
      const name = input.value.trim();
      if (!name) return;
      this.resolved = true;
      this.resolve(name);
      this.close();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      submit();
    });

    new Setting(this.contentEl)
      .addButton(btn => btn
        .setButtonText(t('common.cancel'))
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText(t('common.save'))
        .setCta()
        .onClick(submit));

    input.focus();
    input.select();
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}
