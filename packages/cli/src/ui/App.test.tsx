/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import {
  Config as ServerConfig,
  MCPServerConfig,
  ApprovalMode,
  ToolRegistry,
  AccessibilitySettings,
} from '@gemini-code/core';
import { LoadedSettings, SettingsFile, Settings } from '../config/settings.js';

// Define a more complete mock server config based on actual Config
interface MockServerConfig {
  apiKey: string;
  model: string;
  sandbox: boolean | string;
  targetDir: string;
  debugMode: boolean;
  question?: string;
  fullContext: boolean;
  coreTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>; // Use imported MCPServerConfig
  userAgent: string;
  userMemory: string;
  geminiMdFileCount: number;
  approvalMode: ApprovalMode;
  vertexai?: boolean;
  showMemoryUsage?: boolean;
  accessibility?: AccessibilitySettings;

  getApiKey: Mock<() => string>;
  getModel: Mock<() => string>;
  getSandbox: Mock<() => boolean | string>;
  getTargetDir: Mock<() => string>;
  getToolRegistry: Mock<() => ToolRegistry>; // Use imported ToolRegistry type
  getDebugMode: Mock<() => boolean>;
  getQuestion: Mock<() => string | undefined>;
  getFullContext: Mock<() => boolean>;
  getCoreTools: Mock<() => string[] | undefined>;
  getToolDiscoveryCommand: Mock<() => string | undefined>;
  getToolCallCommand: Mock<() => string | undefined>;
  getMcpServerCommand: Mock<() => string | undefined>;
  getMcpServers: Mock<() => Record<string, MCPServerConfig> | undefined>;
  getUserAgent: Mock<() => string>;
  getUserMemory: Mock<() => string>;
  setUserMemory: Mock<(newUserMemory: string) => void>;
  getGeminiMdFileCount: Mock<() => number>;
  setGeminiMdFileCount: Mock<(count: number) => void>;
  getApprovalMode: Mock<() => ApprovalMode>;
  setApprovalMode: Mock<(skip: ApprovalMode) => void>;
  getVertexAI: Mock<() => boolean | undefined>;
  getShowMemoryUsage: Mock<() => boolean>;
  getAccessibility: Mock<() => AccessibilitySettings>;
}

// Mock @gemini-code/core and its Config class
vi.mock('@gemini-code/core', async (importOriginal) => {
  const actualCore = await importOriginal<typeof import('@gemini-code/core')>();
  const ConfigClassMock = vi
    .fn()
    .mockImplementation((optionsPassedToConstructor) => {
      const opts = { ...optionsPassedToConstructor }; // Clone
      // Basic mock structure, will be extended by the instance in tests
      return {
        apiKey: opts.apiKey || 'test-key',
        model: opts.model || 'test-model-in-mock-factory',
        sandbox: typeof opts.sandbox === 'boolean' ? opts.sandbox : false,
        targetDir: opts.targetDir || '/test/dir',
        debugMode: opts.debugMode || false,
        question: opts.question,
        fullContext: opts.fullContext ?? false,
        coreTools: opts.coreTools,
        toolDiscoveryCommand: opts.toolDiscoveryCommand,
        toolCallCommand: opts.toolCallCommand,
        mcpServerCommand: opts.mcpServerCommand,
        mcpServers: opts.mcpServers,
        userAgent: opts.userAgent || 'test-agent',
        userMemory: opts.userMemory || '',
        geminiMdFileCount: opts.geminiMdFileCount || 0,
        approvalMode: opts.approvalMode ?? ApprovalMode.DEFAULT,
        vertexai: opts.vertexai,
        showMemoryUsage: opts.showMemoryUsage ?? false,
        accessibility: opts.accessibility ?? {},

        getApiKey: vi.fn(() => opts.apiKey || 'test-key'),
        getModel: vi.fn(() => opts.model || 'test-model-in-mock-factory'),
        getSandbox: vi.fn(() =>
          typeof opts.sandbox === 'boolean' ? opts.sandbox : false,
        ),
        getTargetDir: vi.fn(() => opts.targetDir || '/test/dir'),
        getToolRegistry: vi.fn(() => ({}) as ToolRegistry), // Simple mock
        getDebugMode: vi.fn(() => opts.debugMode || false),
        getQuestion: vi.fn(() => opts.question),
        getFullContext: vi.fn(() => opts.fullContext ?? false),
        getCoreTools: vi.fn(() => opts.coreTools),
        getToolDiscoveryCommand: vi.fn(() => opts.toolDiscoveryCommand),
        getToolCallCommand: vi.fn(() => opts.toolCallCommand),
        getMcpServerCommand: vi.fn(() => opts.mcpServerCommand),
        getMcpServers: vi.fn(() => opts.mcpServers),
        getUserAgent: vi.fn(() => opts.userAgent || 'test-agent'),
        getUserMemory: vi.fn(() => opts.userMemory || ''),
        setUserMemory: vi.fn(),
        getGeminiMdFileCount: vi.fn(() => opts.geminiMdFileCount || 0),
        setGeminiMdFileCount: vi.fn(),
        getApprovalMode: vi.fn(() => opts.approvalMode ?? ApprovalMode.DEFAULT),
        setApprovalMode: vi.fn(),
        getVertexAI: vi.fn(() => opts.vertexai),
        getShowMemoryUsage: vi.fn(() => opts.showMemoryUsage ?? false),
        getAccessibility: vi.fn(() => opts.accessibility ?? {}),
      };
    });
  return {
    ...actualCore,
    Config: ConfigClassMock,
    MCPServerConfig: actualCore.MCPServerConfig,
  };
});

// Mock heavy dependencies or those with side effects
vi.mock('./hooks/useGeminiStream', () => ({
  useGeminiStream: vi.fn(() => ({
    streamingState: 'Idle',
    submitQuery: vi.fn(),
    initError: null,
    pendingHistoryItems: [],
  })),
}));

vi.mock('./hooks/useLogger', () => ({
  useLogger: vi.fn(() => ({
    getPreviousUserMessages: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../config/config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    // @ts-expect-error - this is fine
    ...actual,
    loadHierarchicalGeminiMemory: vi
      .fn()
      .mockResolvedValue({ memoryContent: '', fileCount: 0 }),
  };
});

describe('App UI', () => {
  let mockConfig: MockServerConfig;
  let mockSettings: LoadedSettings;
  let currentUnmount: (() => void) | undefined;

  const createMockSettings = (
    settings: Partial<Settings> = {},
  ): LoadedSettings => {
    const userSettingsFile: SettingsFile = {
      path: '/user/settings.json',
      settings: {},
    };
    const workspaceSettingsFile: SettingsFile = {
      path: '/workspace/.gemini/settings.json',
      settings,
    };
    return new LoadedSettings(userSettingsFile, workspaceSettingsFile);
  };

  beforeEach(() => {
    const ServerConfigMocked = vi.mocked(ServerConfig, true);
    mockConfig = new ServerConfigMocked({
      apiKey: 'test-key',
      model: 'test-model-in-options',
      sandbox: false,
      targetDir: '/test/dir',
      debugMode: false,
      userAgent: 'test-agent',
      userMemory: '',
      geminiMdFileCount: 0,
      showMemoryUsage: false,
      // Provide other required fields for ConfigParameters if necessary
    }) as unknown as MockServerConfig;

    // Ensure the getShowMemoryUsage mock function is specifically set up if not covered by constructor mock
    if (!mockConfig.getShowMemoryUsage) {
      mockConfig.getShowMemoryUsage = vi.fn(() => false);
    }
    mockConfig.getShowMemoryUsage.mockReturnValue(false); // Default for most tests

    // Ensure a theme is set so the theme dialog does not appear.
    mockSettings = createMockSettings({ theme: 'Default' });
  });

  afterEach(() => {
    if (currentUnmount) {
      currentUnmount();
      currentUnmount = undefined;
    }
    vi.clearAllMocks(); // Clear mocks after each test
  });

  it('should display default "GEMINI.md" in footer when contextFileName is not set and count is 1', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    // For this test, ensure showMemoryUsage is false or debugMode is false if it relies on that
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        cliVersion="1.0.0"
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve(); // Wait for any async updates
    expect(lastFrame()).toContain('Using 1 GEMINI.md file');
  });

  it('should display default "GEMINI.md" with plural when contextFileName is not set and count is > 1', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        cliVersion="1.0.0"
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 2 GEMINI.md files');
  });

  it('should display custom contextFileName in footer when set and count is 1', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'AGENTS.MD',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        cliVersion="1.0.0"
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 1 AGENTS.MD file');
  });

  it('should display custom contextFileName with plural when set and count is > 1', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'MY_NOTES.TXT',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(3);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        cliVersion="1.0.0"
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 3 MY_NOTES.TXT files');
  });

  it('should not display context file message if count is 0, even if contextFileName is set', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'ANY_FILE.MD',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        cliVersion="1.0.0"
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).not.toContain('ANY_FILE.MD');
  });

  it('should display GEMINI.md and MCP server count when both are present', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getMcpServers.mockReturnValue({
      server1: {} as MCPServerConfig,
    });
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        cliVersion="1.0.0"
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('server');
  });

  it('should display only MCP server count when GEMINI.md count is 0', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getMcpServers.mockReturnValue({
      server1: {} as MCPServerConfig,
      server2: {} as MCPServerConfig,
    });
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        cliVersion="1.0.0"
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 2 MCP servers');
  });

  it('should display theme dialog if no theme is set in settings', async () => {
    mockSettings = createMockSettings({});
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        cliVersion="1.0.0"
      />,
    );
    currentUnmount = unmount;

    expect(lastFrame()).toContain('Select Theme');
  });
});
