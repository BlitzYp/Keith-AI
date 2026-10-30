import type { Message } from 'discord.js';
import type { Respond } from './respond.js';
import type { PostedMessage } from './streamingReply.js';

/**
 * The Discord side of chatting: decides whether a message is for Keith, turns it into a plain
 * ChatRequest, and hands it to `respond`. Kept thin on purpose; the logic lives in respond.ts.
 */
export async function handleDiscordMessage(message: Message, respond: Respond) {
  if (message.author.bot || !message.inGuild()) return;
  if (!(await isForKeith(message))) return;

  // cleanContent turns <@id> into @Name; drop Keith's own mention.
  const keithName = message.guild.members.me?.displayName ?? message.client.user.username;
  const text = message.cleanContent.replaceAll(`@${keithName}`, '').trim();
  if (!text) return;

  await message.channel.sendTyping().catch(() => {});
  await respond(
    {
      guildId: message.guildId,
      channelId: message.channelId,
      speaker: message.member?.displayName ?? message.author.username,
      text,
    },
    asPostedMessage(message),
  );
}

/** Keith answers when @mentioned, or when someone replies to one of Keith's messages. */
async function isForKeith(message: Message): Promise<boolean> {
  const keithId = message.client.user.id;
  if (message.mentions.users.has(keithId)) return true;
  if (!message.reference?.messageId) return false;
  const repliedTo = await message.fetchReference().catch(() => null);
  return repliedTo?.author.id === keithId;
}

function asPostedMessage(message: Message): PostedMessage {
  return {
    // Replies don't ping the person Keith is answering.
    reply: async (content) =>
      asPostedMessage(await message.reply({ content, allowedMentions: { repliedUser: false } })),
    edit: (content) => message.edit(content),
  };
}
