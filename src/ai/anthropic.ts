import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { LeagueConfig } from '../config/league';
import type { Player } from '../data/player';
import type { DraftStrategy } from '../strategy/types';
import {
  askSystemPrompt,
  finalizeSystemPrompt,
  interviewSystemPrompt,
  MODIFY_SYSTEM,
} from './prompts';
import type { AIProvider, ChatTurn, FinalizeInput, InterviewInput } from './provider';
import { AiStrategyOutputSchema, type AiStrategyOutput } from './schemas';

const MODEL = 'claude-opus-5';

/**
 * Anthropic implementation of the AI provider. Runs directly in the browser
 * with the user's own API key: FootBud has no server, so the key lives in
 * localStorage and requests go straight to the Claude API.
 */
export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  async interviewTurn(input: InterviewInput, onToken: (text: string) => void): Promise<string> {
    const messages: Anthropic.MessageParam[] =
      input.turns.length > 0
        ? input.turns.map((t) => ({ role: t.role, content: t.content }))
        : [{ role: 'user', content: 'Hi, help me build my draft strategy.' }];
    try {
      const stream = this.client.messages.stream({
        model: MODEL,
        max_tokens: 1500,
        output_config: { effort: 'low' },
        system: interviewSystemPrompt(input.config),
        messages,
      });
      stream.on('text', onToken);
      const final = await stream.finalMessage();
      return final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    } catch (e) {
      throw friendlyError(e);
    }
  }

  async interpretStrategy(input: FinalizeInput): Promise<AiStrategyOutput> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.document) {
      if (input.document.kind === 'pdf') {
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: input.document.data,
          },
        });
        content.push({
          type: 'text',
          text: `The attached document (${input.document.fileName}) is the user's draft strategy. Extract it into the structured format.`,
        });
      } else {
        content.push({
          type: 'text',
          text: `The user's draft strategy document (${input.document.fileName}):\n\n${input.document.data}\n\nExtract it into the structured format.`,
        });
      }
    }
    if (input.turns && input.turns.length > 0) {
      const transcript = input.turns
        .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
        .join('\n\n');
      content.push({
        type: 'text',
        text: `Strategy-building conversation with the user:\n\n${transcript}\n\nBuild the user's structured strategy from what they said.`,
      });
    }
    if (content.length === 0) {
      throw new Error('Nothing to interpret: no conversation or document provided.');
    }
    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: 'medium', format: zodOutputFormat(AiStrategyOutputSchema) },
        system: finalizeSystemPrompt(input.config, input.players),
        messages: [{ role: 'user', content }],
      });
      if (!response.parsed_output) {
        throw new Error('The model did not return a valid strategy. Try again.');
      }
      return response.parsed_output;
    } catch (e) {
      throw friendlyError(e);
    }
  }

  async modifyStrategy(
    config: LeagueConfig,
    players: Player[],
    strategy: DraftStrategy,
    instruction: string,
  ): Promise<AiStrategyOutput> {
    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: 'medium', format: zodOutputFormat(AiStrategyOutputSchema) },
        system: `${MODIFY_SYSTEM}\n\nLeague: ${config.numberOfTeams} teams, user slot ${config.userDraftSlot}. Known player names for playerNotes: ${players.map((p) => p.name).join(', ')}`,
        messages: [
          {
            role: 'user',
            content: `Current strategy:\n${JSON.stringify(strategy, null, 2)}\n\nInstruction: ${instruction}`,
          },
        ],
      });
      if (!response.parsed_output) {
        throw new Error('The model did not return a valid strategy. Try again.');
      }
      return response.parsed_output;
    } catch (e) {
      throw friendlyError(e);
    }
  }

  async askDraftQuestion(
    snapshot: unknown,
    history: ChatTurn[],
    question: string,
    onToken: (text: string) => void,
  ): Promise<string> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Current draft snapshot from the engine:\n${JSON.stringify(snapshot)}`,
      },
      {
        role: 'assistant',
        content: 'Got it. I have the current draft snapshot. What would you like to know?',
      },
      ...history.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.content })),
      { role: 'user', content: question },
    ];
    try {
      const stream = this.client.messages.stream({
        model: MODEL,
        max_tokens: 2000,
        output_config: { effort: 'low' },
        system: askSystemPrompt(),
        messages,
      });
      stream.on('text', onToken);
      const final = await stream.finalMessage();
      return final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    } catch (e) {
      throw friendlyError(e);
    }
  }
}

function friendlyError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) {
    return new Error('The API key was rejected. Check it in AI settings.');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new Error('Rate limited by the API. Wait a moment and try again.');
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new Error('Could not reach the Claude API. Check your connection.');
  }
  if (e instanceof Anthropic.APIError) {
    return new Error(`Claude API error: ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}
