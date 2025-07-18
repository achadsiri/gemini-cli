/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { MCPServerConfig } from '@gemini-code/core';
import stripJsonComments from 'strip-json-comments';
import { DefaultLight } from '../ui/themes/default-light.js';
import { DefaultDark } from '../ui/themes/default.js';

export const SETTINGS_DIRECTORY_NAME = '.gemini';
export const USER_SETTINGS_DIR = path.join(homedir(), SETTINGS_DIRECTORY_NAME);
export const USER_SETTINGS_PATH = path.join(USER_SETTINGS_DIR, 'settings.json');

export enum SettingScope {
  User = 'User',
  Workspace = 'Workspace',
}

export interface AccessibilitySettings {
  disableLoadingPhrases?: boolean;
}

export interface Settings {
  theme?: string;
  sandbox?: boolean | string;
  coreTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  showMemoryUsage?: boolean;
  contextFileName?: string;
  accessibility?: AccessibilitySettings;

  // Git-aware file filtering settings
  fileFiltering?: {
    respectGitIgnore?: boolean;
    allowBuildArtifacts?: boolean;
  };

  // Add other settings here.
}

export interface SettingsFile {
  settings: Settings;
  path: string;
}
export class LoadedSettings {
  constructor(user: SettingsFile, workspace: SettingsFile) {
    this.user = user;
    this.workspace = workspace;
    this._merged = this.computeMergedSettings();
  }

  readonly user: SettingsFile;
  readonly workspace: SettingsFile;

  private _merged: Settings;

  get merged(): Settings {
    return this._merged;
  }

  private computeMergedSettings(): Settings {
    return {
      ...this.user.settings,
      ...this.workspace.settings,
    };
  }

  forScope(scope: SettingScope): SettingsFile {
    switch (scope) {
      case SettingScope.User:
        return this.user;
      case SettingScope.Workspace:
        return this.workspace;
      default:
        throw new Error(`Invalid scope: ${scope}`);
    }
  }

  setValue(
    scope: SettingScope,
    key: keyof Settings,
    value: string | Record<string, MCPServerConfig> | undefined,
  ): void {
    const settingsFile = this.forScope(scope);
    // @ts-expect-error - value can be string | Record<string, MCPServerConfig>
    settingsFile.settings[key] = value;
    this._merged = this.computeMergedSettings();
    saveSettings(settingsFile);
  }
}

/**
 * Loads settings from user and workspace directories.
 * Project settings override user settings.
 */
export function loadSettings(workspaceDir: string): LoadedSettings {
  let userSettings: Settings = {};
  let workspaceSettings: Settings = {};

  // Load user settings
  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const userContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf-8');
      userSettings = JSON.parse(stripJsonComments(userContent)) as Settings;
      // Support legacy theme names
      if (userSettings.theme && userSettings.theme === 'VS') {
        userSettings.theme = DefaultLight.name;
      } else if (userSettings.theme && userSettings.theme === 'VS2015') {
        userSettings.theme = DefaultDark.name;
      }
    }
  } catch (error) {
    console.error('Error reading user settings file:', error);
  }

  const workspaceSettingsPath = path.join(
    workspaceDir,
    SETTINGS_DIRECTORY_NAME,
    'settings.json',
  );

  // Load workspace settings
  try {
    if (fs.existsSync(workspaceSettingsPath)) {
      const projectContent = fs.readFileSync(workspaceSettingsPath, 'utf-8');
      workspaceSettings = JSON.parse(
        stripJsonComments(projectContent),
      ) as Settings;
      if (workspaceSettings.theme && workspaceSettings.theme === 'VS') {
        workspaceSettings.theme = DefaultLight.name;
      } else if (
        workspaceSettings.theme &&
        workspaceSettings.theme === 'VS2015'
      ) {
        workspaceSettings.theme = DefaultDark.name;
      }
    }
  } catch (error) {
    console.error('Error reading workspace settings file:', error);
  }

  return new LoadedSettings(
    { path: USER_SETTINGS_PATH, settings: userSettings },
    { path: workspaceSettingsPath, settings: workspaceSettings },
  );
}

export function saveSettings(settingsFile: SettingsFile): void {
  try {
    // Ensure the directory exists
    const dirPath = path.dirname(settingsFile.path);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(
      settingsFile.path,
      JSON.stringify(settingsFile.settings, null, 2),
      'utf-8',
    );
  } catch (error) {
    console.error('Error saving user settings file:', error);
  }
}
