import { App, Modal, Notice, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type VaultTimeTrackerPlugin from './main';
import { TimeTrackerSettings } from './types';

export class VTTSettingsTab extends PluginSettingTab {
  plugin: VaultTimeTrackerPlugin;

  constructor(app: App, plugin: VaultTimeTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const s = this.plugin.storage.getSettings();

    containerEl.createEl('h2', { text: 'Vault Time Tracker' });

    // ── Tracking ──────────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Tracking' });

    new Setting(containerEl)
      .setName('Count time while non-note views are active')
      .setDesc('Keep the timer running when Settings, Graph View, Canvas, etc. are in focus. The last active note accumulates the time.')
      .addToggle(t => t
        .setValue(s.countWhileNonNoteViewActive)
        .onChange(async v => {
          s.countWhileNonNoteViewActive = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Notes inside these folders will not be tracked.');

    const excludedSection = containerEl.createDiv();

    const renderExcludedFolders = () => {
      excludedSection.empty();
      const settings = this.plugin.storage.getSettings();

      // Current excluded folders — one row each with a Remove button
      for (const folder of settings.excludedFolders) {
        new Setting(excludedSection)
          .setName(folder)
          .addButton(btn => btn
            .setButtonText('Remove')
            .setWarning()
            .onClick(async () => {
              settings.excludedFolders = settings.excludedFolders.filter(f => f !== folder);
              await this.plugin.saveSettings();
              renderExcludedFolders();
            })
          );
      }

      // All vault subfolders not already excluded
      const allFolders = this.app.vault.getAllLoadedFiles()
        .filter((f): f is TFolder => f instanceof TFolder && f.path !== '' && f.path !== '/')
        .map(f => f.path)
        .sort();

      const available = allFolders.filter(f => !settings.excludedFolders.includes(f));

      if (available.length > 0) {
        let toAdd = available[0];
        new Setting(excludedSection)
          .setName('Add folder')
          .addDropdown(drop => {
            for (const f of available) drop.addOption(f, f);
            drop.setValue(toAdd);
            drop.onChange(v => { toAdd = v; });
          })
          .addButton(btn => btn
            .setButtonText('Add')
            .setCta()
            .onClick(async () => {
              if (toAdd && !settings.excludedFolders.includes(toAdd)) {
                settings.excludedFolders = [...settings.excludedFolders, toAdd];
                await this.plugin.saveSettings();
                renderExcludedFolders();
              }
            })
          );
      } else if (allFolders.length === 0) {
        excludedSection.createEl('p', {
          text: 'No subfolders in this vault.',
          cls: 'setting-item-description',
        });
      }
    };

    renderExcludedFolders();

    // ── Idle Detection ────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Idle Detection' });

    new Setting(containerEl)
      .setName('Idle detection mode')
      .setDesc(
        'Decides what counts as being away. On Auto, the timer only pauses if your whole computer ' +
        'has been idle — switching to Chrome or another app keeps it running. ' +
        'On "Obsidian only", switching to any other app counts as inactive and the timer pauses.'
      )
      .addDropdown(drop => drop
        .addOption('auto', 'Auto — pauses when computer is idle (recommended)')
        .addOption('system', 'Computer-level — any app activity counts as active')
        .addOption('window', 'Obsidian only — switching apps counts as inactive')
        .addOption('off', 'Disabled — never pauses automatically')
        .setValue(s.idleDetectionMode)
        .onChange(async v => {
          s.idleDetectionMode = v as TimeTrackerSettings['idleDetectionMode'];
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Idle threshold (minutes)')
      .setDesc('Pause tracking after this many minutes of inactivity. Set to 0 to disable.')
      .addText(text => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.style.width = '64px';
        text.setValue(String(s.idleThresholdMinutes));
        text.onChange(async v => {
          const num = parseInt(v, 10);
          if (!isNaN(num) && num >= 0) {
            s.idleThresholdMinutes = num;
            await this.plugin.saveSettings();
          }
        });
      });

    // ── Performance ───────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Performance & Storage' });

    new Setting(containerEl)
      .setName('Auto-save interval (seconds)')
      .setDesc('How often to write data to disk. Lower = safer against crashes, slightly more disk I/O.')
      .addSlider(sl => sl
        .setLimits(10, 300, 5)
        .setValue(s.saveIntervalSeconds)
        .setDynamicTooltip()
        .onChange(async v => {
          s.saveIntervalSeconds = v;
          await this.plugin.saveSettings();
        })
      );

    // ── View ──────────────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'View' });

    new Setting(containerEl)
      .setName('Week starts on')
      .addDropdown(drop => drop
        .addOption('1', 'Monday')
        .addOption('0', 'Sunday')
        .setValue(String(s.weekStartsOn))
        .onChange(async v => {
          s.weekStartsOn = Number(v) as 0 | 1;
          await this.plugin.saveSettings();
        })
      );

    // ── Data Management ───────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Data Management' });

    new Setting(containerEl)
      .setName('Export data')
      .setDesc('Save a full JSON copy of all tracked time to your vault root.')
      .addButton(btn => btn
        .setButtonText('Export JSON')
        .onClick(async () => {
          try {
            const data = JSON.stringify(this.plugin.storage.getData(), null, 2);
            const filename = `vault-time-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
            await this.app.vault.create(filename, data);
            new Notice(`[VTT] Exported to ${filename}`);
          } catch (e) {
            new Notice('[VTT] Export failed: ' + String(e));
          }
        })
      );

    new Setting(containerEl)
      .setName('Clear all tracking data')
      .setDesc('Permanently deletes all recorded time. This cannot be undone.')
      .addButton(btn => btn
        .setButtonText('Clear all data')
        .setWarning()
        .onClick(() => {
          new ConfirmClearModal(this.app, async () => {
            const d = this.plugin.storage.getData();
            d.dailyTotals = {};
            d.sessions = [];
            d.renames = [];
            await this.plugin.saveSettings();
            new Notice('[VTT] All tracking data cleared.');
          }).open();
        })
      );
  }
}

class ConfirmClearModal extends Modal {
  private onConfirm: () => Promise<void>;

  constructor(app: App, onConfirm: () => Promise<void>) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Clear all tracking data?' });
    contentEl.createEl('p', {
      text: 'This will permanently delete all recorded time for all notes. Daily totals, session logs, and rename history will be erased. This cannot be undone.',
    });

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });

    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());

    const confirmBtn = buttons.createEl('button', { text: 'Clear all data', cls: 'mod-warning' });
    confirmBtn.addEventListener('click', async () => {
      this.close();
      await this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
