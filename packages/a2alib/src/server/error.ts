/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as schema from '../schema.js';

/**
 * Custom error class for A2A server operations, incorporating JSON-RPC error codes.
 */
export class A2AError extends Error {
  code: number;
  data?: unknown;
  taskId?: string; // Optional task ID context

  constructor(code: number, message: string, data?: unknown, taskId?: string) {
    super(message);
    this.name = 'A2AError';
    this.code = code;
    this.data = data;
    this.taskId = taskId; // Store associated task ID if provided
  }

  /**
   * Formats the error into a standard JSON-RPC error object structure.
   */
  toJSONRPCError(): schema.JSONRPCError {
    const errorObject: schema.JSONRPCError = {
      code: this.code,
      message: this.message,
    };
    if (this.data !== undefined) {
      errorObject.data = this.data;
    }
    return errorObject;
  }

  // Static factory methods for common errors

  static parseError(message: string, data?: unknown): A2AError {
    return new A2AError(-32700, message, data);
  }

  static invalidRequest(message: string, data?: unknown): A2AError {
    return new A2AError(-32600, message, data);
  }

  static methodNotFound(method: string): A2AError {
    return new A2AError(-32601, `Method not found: ${method}`);
  }

  static invalidParams(message: string, data?: unknown): A2AError {
    return new A2AError(-32602, message, data);
  }

  static internalError(message: string, data?: unknown): A2AError {
    return new A2AError(-32603, message, data);
  }

  static taskNotFound(taskId: string): A2AError {
    return new A2AError(-32001, `Task not found: ${taskId}`, undefined, taskId);
  }

  static taskNotCancelable(taskId: string): A2AError {
    return new A2AError(
      -32002,
      `Task not cancelable: ${taskId}`,
      undefined,
      taskId,
    );
  }

  static pushNotificationNotSupported(): A2AError {
    return new A2AError(-32003, 'Push Notification is not supported');
  }

  static unsupportedOperation(operation: string): A2AError {
    return new A2AError(-32004, `Unsupported operation: ${operation}`);
  }
}
