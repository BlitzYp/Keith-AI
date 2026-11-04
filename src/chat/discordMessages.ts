import { escapeMarkdown, type Client, type Message } from 'discord.js';
import type { SpokenMessage } from '../voice/session.js';
import { downloadImages, type Attachment } from './images.js';
import type { Respond } from './respond.js';
import type { PostedMessage } from './streamingReply.js';

/**
 * The Discord side of chatting: decides whether a message is for Keith, turns it into a plain
 * ChatRequest, and hands it to `respond`. Kept thin on purpose; the logic lives in respond.ts.
 */
export async function handleDiscordMessage(
  message: Message,
  respond: Respond,
  /** False for text-only models: pictures are then left out (LLM_SEES_IMAGES). */
  seesImages: boolean,
) {
  if (message.author.bot || !message.inGuild()) return;
  const repliedTo = message.reference?.messageId
    ? await message.fetchReference().catch(() => null)
    : null;
  if (!isForKeith(message, repliedTo)) return;

  // cleanContent turns <@id> into @Name; drop Keith's own mention.
  const keithName = message.guild.members.me?.displayName ?? message.client.user.username;
  const text = message.cleanContent.replaceAll(`@${keithName}`, '').trim();

  await message.channel.sendTyping().catch(() => {});
  // Pictures in the message, and in the one it replies to ("@Keith what is this?" under a photo).
  const images = seesImages
    ? await downloadImages([...attachmentsOf(message), ...(repliedTo ? attachmentsOf(repliedTo) : [])])
    : [];
  if (!text && images.length === 0) return;

  await respond(
    {
      guildId: message.guildId,
      channelId: message.channelId,
      speaker: message.member?.displayName ?? message.author.username,
      userId: message.author.id,
      text,
      images,
    },
    asPostedMessage(message),
  );
}

function attachmentsOf(message: Message): Attachment[] {
  return message.attachments.map((a) => ({ url: a.url, contentType: a.contentType, size: a.size }));
}

/**
 * Answers something said in voice. The transcript goes into the text channel first: that shows
 * everyone what Keith heard (and that it's listening), and gives the reply something to reply to.
 * The reply is then spoken too, because it's in the channel /join was used in.
 */
export async function handleSpokenMessage(client: Client, spoken: SpokenMessage, respond: Respond) {
  const channel = await client.channels.fetch(spoken.textChannelId).catch(() => null);
  if (!channel?.isSendable()) return;

  const transcript = await channel.send({
    content: `🎙️ **${escapeMarkdown(spoken.speaker)}:** ${escapeMarkdown(spoken.text)}`,
    allowedMentions: { parse: [] }, // saying "at everyone" out loud shouldn't ping anybody
  });
  await respond(
    {
      guildId: spoken.guildId,
      channelId: spoken.textChannelId,
      speaker: spoken.speaker,
      userId: spoken.userId,
      text: spoken.text,
    },
    asPostedMessage(transcript),
  );
}

/** Keith answers when @mentioned, or when someone replies to one of Keith's messages. */
function isForKeith(message: Message, repliedTo: Message | null): boolean {
  const keithId = message.client.user.id;
  return message.mentions.users.has(keithId) || repliedTo?.author.id === keithId;
}

function asPostedMessage(message: Message): PostedMessage {
  return {
    // Replies don't ping the person Keith is answering.
    reply: async (content) =>
      asPostedMessage(await message.reply({ content, allowedMentions: { repliedUser: false } })),
    edit: (content) => message.edit(content),
  };
}
