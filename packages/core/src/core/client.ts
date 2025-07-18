/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GenerateContentConfig,
  GoogleGenAI,
  Part,
  SchemaUnion,
  PartListUnion,
  Content,
  Tool,
  GenerateContentResponse,
} from '@google/genai';
import process from 'node:process';
import { getFolderStructure } from '../utils/getFolderStructure.js';
import { Turn, ServerGeminiStreamEvent, GeminiEventType } from './turn.js';
import { Config } from '../config/config.js';
import { getCoreSystemPrompt } from './prompts.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { checkNextSpeaker } from '../utils/nextSpeakerChecker.js';
import { reportError } from '../utils/errorReporting.js';
import { GeminiChat } from './geminiChat.js';
import { retryWithBackoff } from '../utils/retry.js';
import { getErrorMessage } from '../utils/errors.js';
import { tokenLimit } from './tokenLimits.js';

export class GeminiClient {
  private chat: Promise<GeminiChat>;
  private client: GoogleGenAI;
  private model: string;
  private generateContentConfig: GenerateContentConfig = {
    temperature: 0,
    topP: 1,
  };
  private readonly MAX_TURNS = 100;

  constructor(private config: Config) {
    const userAgent = config.getUserAgent();
    const apiKeyFromConfig = config.getApiKey();
    const vertexaiFlag = config.getVertexAI();

    this.client = new GoogleGenAI({
      apiKey: apiKeyFromConfig === '' ? undefined : apiKeyFromConfig,
      vertexai: vertexaiFlag,
      httpOptions: {
        headers: {
          'User-Agent': userAgent,
        },
      },
    });
    this.model = config.getModel();
    this.chat = this.startChat();
  }

  getChat(): Promise<GeminiChat> {
    return this.chat;
  }

  private async getEnvironment(): Promise<Part[]> {
    const cwd = process.cwd();
    const today = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const platform = process.platform;
    const folderStructure = await getFolderStructure(cwd);
    const context = `
  Okay, just setting up the context for our chat.
  Today is ${today}.
  My operating system is: ${platform}
  I'm currently working in the directory: ${cwd}
  ${folderStructure}
          `.trim();

    const initialParts: Part[] = [{ text: context }];
    const toolRegistry = await this.config.getToolRegistry();

    // Add full file context if the flag is set
    if (this.config.getFullContext()) {
      try {
        const readManyFilesTool = toolRegistry.getTool(
          'read_many_files',
        ) as ReadManyFilesTool;
        if (readManyFilesTool) {
          // Read all files in the target directory
          const result = await readManyFilesTool.execute(
            {
              paths: ['**/*'], // Read everything recursively
              useDefaultExcludes: true, // Use default excludes
            },
            AbortSignal.timeout(30000),
          );
          if (result.llmContent) {
            initialParts.push({
              text: `\n--- Full File Context ---\n${result.llmContent}`,
            });
          } else {
            console.warn(
              'Full context requested, but read_many_files returned no content.',
            );
          }
        } else {
          console.warn(
            'Full context requested, but read_many_files tool not found.',
          );
        }
      } catch (error) {
        // Not using reportError here as it's a startup/config phase, not a chat/generation phase error.
        console.error('Error reading full file context:', error);
        initialParts.push({
          text: '\n--- Error reading full file context ---',
        });
      }
    }

    return initialParts;
  }

  private async startChat(extraHistory?: Content[]): Promise<GeminiChat> {
    const envParts = await this.getEnvironment();
    const toolRegistry = await this.config.getToolRegistry();
    const toolDeclarations = toolRegistry.getFunctionDeclarations();
    const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];
    const initialHistory: Content[] = [
      {
        role: 'user',
        parts: envParts,
      },
      {
        role: 'model',
        parts: [{ text: 'Got it. Thanks for the context!' }],
      },
    ];
    const history = initialHistory.concat(extraHistory ?? []);
    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory);

      return new GeminiChat(
        this.client,
        this.client.models,
        this.model,
        {
          systemInstruction,
          ...this.generateContentConfig,
          tools,
        },
        history,
      );
    } catch (error) {
      await reportError(
        error,
        'Error initializing Gemini chat session.',
        history,
        'startChat',
      );
      throw new Error(`Failed to initialize chat: ${getErrorMessage(error)}`);
    }
  }

  async *sendMessageStream(
    request: PartListUnion,
    signal: AbortSignal,
    turns: number = this.MAX_TURNS,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    if (!turns) {
      return;
    }

    const compressed = await this.tryCompressChat();
    if (compressed) {
      yield { type: GeminiEventType.ChatCompressed };
    }
    const chat = await this.chat;
    const turn = new Turn(chat);
    const resultStream = turn.run(request, signal);
    for await (const event of resultStream) {
      yield event;
    }
    if (!turn.pendingToolCalls.length && signal && !signal.aborted) {
      const nextSpeakerCheck = await checkNextSpeaker(chat, this, signal);
      if (nextSpeakerCheck?.next_speaker === 'model') {
        const nextRequest = [{ text: 'Please continue.' }];
        yield* this.sendMessageStream(nextRequest, signal, turns - 1);
      }
    }
  }

  async generateJson(
    contents: Content[],
    schema: SchemaUnion,
    abortSignal: AbortSignal,
    model: string = 'gemini-2.0-flash',
    config: GenerateContentConfig = {},
  ): Promise<Record<string, unknown>> {
    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory);
      const requestConfig = {
        abortSignal,
        ...this.generateContentConfig,
        ...config,
      };

      const apiCall = () =>
        this.client.models.generateContent({
          model,
          config: {
            ...requestConfig,
            systemInstruction,
            responseSchema: schema,
            responseMimeType: 'application/json',
          },
          contents,
        });

      const result = await retryWithBackoff(apiCall);

      const text = getResponseText(result);
      if (!text) {
        const error = new Error(
          'API returned an empty response for generateJson.',
        );
        await reportError(
          error,
          'Error in generateJson: API returned an empty response.',
          contents,
          'generateJson-empty-response',
        );
        throw error;
      }
      try {
        return JSON.parse(text);
      } catch (parseError) {
        await reportError(
          parseError,
          'Failed to parse JSON response from generateJson.',
          {
            responseTextFailedToParse: text,
            originalRequestContents: contents,
          },
          'generateJson-parse',
        );
        throw new Error(
          `Failed to parse API response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
      }
    } catch (error) {
      if (abortSignal.aborted) {
        // Regular cancellation error, fail normally
        throw error;
      }

      // Avoid double reporting for the empty response case handled above
      if (
        error instanceof Error &&
        error.message === 'API returned an empty response for generateJson.'
      ) {
        throw error;
      }
      await reportError(
        error,
        'Error generating JSON content via API.',
        contents,
        'generateJson-api',
      );
      const message =
        error instanceof Error ? error.message : 'Unknown API error.';
      throw new Error(`Failed to generate JSON content: ${message}`);
    }
  }

  async generateContent(
    contents: Content[],
    generationConfig: GenerateContentConfig,
    abortSignal: AbortSignal,
  ): Promise<GenerateContentResponse> {
    const modelToUse = this.model;
    const configToUse: GenerateContentConfig = {
      ...this.generateContentConfig,
      ...generationConfig,
    };

    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory);

      const requestConfig = {
        abortSignal,
        ...configToUse,
        systemInstruction,
      };

      const apiCall = () =>
        this.client.models.generateContent({
          model: modelToUse,
          config: requestConfig,
          contents,
        });

      const result = await retryWithBackoff(apiCall);
      return result;
    } catch (error) {
      if (abortSignal.aborted) {
        throw error;
      }

      await reportError(
        error,
        `Error generating content via API with model ${modelToUse}.`,
        {
          requestContents: contents,
          requestConfig: configToUse,
        },
        'generateContent-api',
      );
      const message =
        error instanceof Error ? error.message : 'Unknown API error.';
      throw new Error(
        `Failed to generate content with model ${modelToUse}: ${message}`,
      );
    }
  }

  private async tryCompressChat(): Promise<boolean> {
    const chat = await this.chat;
    const history = chat.getHistory(true); // Get curated history

    // Count tokens using the models module from the GoogleGenAI client instance
    const { totalTokens } = await this.client.models.countTokens({
      model: this.model,
      contents: history,
    });

    if (totalTokens === undefined) {
      // If token count is undefined, we can't determine if we need to compress.
      console.warn(
        `Could not determine token count for model ${this.model}. Skipping compression check.`,
      );
      return false;
    }
    const tokenCount = totalTokens; // Now guaranteed to be a number

    const limit = tokenLimit(this.model);
    if (!limit) {
      // If no limit is defined for the model, we can't compress.
      console.warn(
        `No token limit defined for model ${this.model}. Skipping compression check.`,
      );
      return false;
    }

    if (tokenCount < 0.95 * limit) {
      return false;
    }
    const summarizationRequestMessage = {
      text: 'Summarize our conversation up to this point. The summary should be a concise yet comprehensive overview of all key topics, questions, answers, and important details discussed. This summary will replace the current chat history to conserve tokens, so it must capture everything essential to understand the context and continue our conversation effectively as if no information was lost.',
    };
    const response = await chat.sendMessage({
      message: summarizationRequestMessage,
    });
    this.chat = this.startChat([
      {
        role: 'user',
        parts: [summarizationRequestMessage],
      },
      {
        role: 'model',
        parts: [{ text: response.text }],
      },
    ]);

    return true;
  }
}
