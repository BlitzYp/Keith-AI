import type { Client, Message } from 'discord.js';
import { config } from './config.js';
import { HistoryStore } from './llm/history.js';
import { holdBackPartialTag, stripThinking, streamChat, type ChatMessage } from './llm/client.js';
import { SentenceSplitter } from './tts/text.js';
import { voiceManager } from './voice/manager.js';

export const history = new HistoryStore(config.bot.historyMaxMessages);

const DISCORD_LIMIT = 1900; // leave headroom under Discord's 2000-char limit
const EDIT_INTERVAL_MS = 1000; // Discord rate-limits edits; ~1/s is safe

/** Serializes replies per channel so history never interleaves. */
const channelLocks = new Map<string, Promise<void>>();

function withChannelLock(channelId: string, task: () => Promise<void>): Promise<void> {
  const prev = channelLocks.get(channelId) ?? Promise.resolve();
  const next = prev.then(task, task);
  channelLocks.set(
    channelId,
    next.catch(() => {}),
  );
  return next;
}

async function isTriggered(client: Client, message: Message): Promise<boolean> {
  if (!client.user) return false;
  if (message.mentions.users.has(client.user.id)) return true;
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    if (ref?.author.id === client.user.id) return true;
  }
  return false;
}

export async function handleMessage(client: Client, message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild()) return;
  if (!(await isTriggered(client, message))) return;

  // cleanContent turns <@id> into @Name; drop the bot's own mention.
  const botName = message.guild.members.me?.displayName ?? client.user!.username;
  const text = message.cleanContent.replaceAll(`@${botName}`, '').trim();
  if (!text) return;

  const speaker = message.member?.displayName ?? message.author.username;

  await withChannelLock(message.channelId, async () => {
    history.push(message.channelId, { role: 'user', content: `${speaker}: ${text}` });

    const messages: ChatMessage[] = [
      { role: 'system', content: config.bot.systemPrompt },
      ...history.get(message.channelId),
    ];

    await message.channel.sendTyping().catch(() => {});

    // Speak the reply too if we're in a VC bound to this text channel.
    const voice = voiceManager.get(message.guildId);
    const speakHere = voice && voice.textChannelId === message.channelId ? voice : undefined;
    // /shutup bumps the session's generation; after that, stop speaking this reply.
    const generation = speakHere?.generation;
    const splitter = new SentenceSplitter();
    let fed = '';
    const feedSpeech = (visible: string) => {
      if (!speakHere || speakHere.generation !== generation) return;
      // Compare by content, not length: if earlier text changed, resync without re-speaking it.
      if (visible.startsWith(fed)) {
        for (const sentence of splitter.push(visible.slice(fed.length))) speakHere.speak(sentence);
      }
      fed = visible;
    };

    const reply = new StreamingReply(message);
    let raw = '';
    try {
      for await (const chunk of streamChat(messages)) {
        raw += chunk;
        const visible = holdBackPartialTag(stripThinking(raw));
        reply.update(visible);
        feedSpeech(visible);
      }
    } catch (err) {
      console.error('[llm]', err);
      reply.update(`(Couldn't reach the model: ${(err as Error).message})`);
      await reply.finish();
      return;
    }

    const final = stripThinking(raw).trim() || '...';
    reply.update(final);
    await reply.finish();

    feedSpeech(stripThinking(raw));
    const rest = splitter.flush();
    if (speakHere && rest && speakHere.generation === generation) speakHere.speak(rest);

    history.push(message.channelId, { role: 'assistant', content: final });
  });
}

/**
 * Shows the reply as it streams by editing a Discord message about once a
 * second. Spills over into extra messages when it passes the length limit.
 */
class StreamingReply {
  private readonly sent: Message[] = [];
  private text = '';
  private lastRender = '';
  private timer: NodeJS.Timeout | null = null;
  private rendering: Promise<void> = Promise.resolve();

  constructor(private readonly origin: Message) {}

  update(text: string): void {
    this.text = text;
    if (!this.timer && this.text.trim()) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.rendering = this.rendering.then(() => this.render());
      }, this.sent.length === 0 ? 0 : EDIT_INTERVAL_MS);
    }
  }

  async finish(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.rendering = this.rendering.then(() => this.render());
    await this.rendering;
  }

  private async render(): Promise<void> {
    const text = this.text.trim();
    if (!text || text === this.lastRender) return;
    this.lastRender = text;

    const parts = chunk(text, DISCORD_LIMIT);
    try {
      for (let i = 0; i < parts.length; i++) {
        const existing = this.sent[i];
        if (!existing) {
          const msg =
            i === 0
              ? await this.origin.reply({ content: parts[i], allowedMentions: { repliedUser: false } })
              : await this.sent[i - 1]!.reply({ content: parts[i], allowedMentions: { repliedUser: false } });
          this.sent.push(msg);
        } else if (existing.content !== parts[i]) {
          await existing.edit(parts[i]!);
        }
      }
    } catch (err) {
      console.error('[discord] failed to send/edit reply:', (err as Error).message);
    }
  }
}

function chunk(text: string, size: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size) {
    // Prefer breaking at a newline or space near the limit.
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}
