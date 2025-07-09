/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
} from './types.js';

export const backgroundCommand: SlashCommand = {
  name: 'background',
  altName: 'bg',
  description: 'Commands for managing the background agent\'s tasks.',
  action: unimplementedAction,
  subCommands: [
    {
      name: 'start',
      description: 'Start a new task with the provided prompt.',
      action: unimplementedAction,
    },
    {
      name: 'stop',
      description: 'Stops a running task.',
      action: unimplementedAction,
    },
    {
      name: 'delete',
      description: 'Deletes a task.',
      action: unimplementedAction,
    },
    {
      name: 'list',
      description: 'List all tasks.',
      action: unimplementedAction,
    },
    {
      name: 'get',
      description: 'Returns the a view of the task: name, status, status message, and artifacts.',
      action: unimplementedAction,
    },
    {
      name: 'logs',
      description: 'Returns recent task messages.',
      action: unimplementedAction,
    },
  ],
};

async function unimplementedAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  return {
    type: 'message',
    messageType: 'error',
    content: `This command is not yet implemented. Args: ${args}`,
  };
}
