import {
  ChatInputCommandInteraction,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import type { HistoryStore } from './chat/history.js';
import { config } from './config.js';
import type { ListenMode } from './voice/addressing.js';
import { voiceManager } from './voice/manager.js';

const name = config.bot.name;

/** How each /listen mode is described, in the command's choices and in Keith's replies. */
const LISTEN_MODES: Record<ListenMode, string> = {
  name: `only when someone says "${name}"`,
  everyone: 'to everything anyone says',
};

export const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel: I listen, answer out loud, and post the chat here'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Say something in the voice channel')
    .addStringOption((o) => o.setName('text').setDescription('What to say').setRequired(true)),
  new SlashCommandBuilder().setName('shutup').setDescription('Stop talking right now'),
  new SlashCommandBuilder()
    .setName('listen')
    .setDescription(`Choose what I answer in voice: everything, or only when someone says "${name}"`)
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Who I answer')
        .setRequired(true)
        .addChoices(
          { name: `Only when someone says "${name}"`, value: 'name' },
          { name: 'Everything anyone says', value: 'everyone' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('musings')
    .setDescription('Turn on or off my habit of saying something ominous when the voice channel goes quiet')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('On or off')
        .setRequired(true)
        .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }),
    ),
  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Forget the conversation history in this channel'),
].map((c) => c.toJSON());

export async function registerCommands(): Promise<void> {
  const rest = new REST().setToken(config.discord.token);
  const { clientId, guildId } = config.discord;
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`Registered ${commands.length} slash commands in guild ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`Registered ${commands.length} global slash commands (may take a while to appear)`);
  }
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  history: HistoryStore,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: 'Use me inside a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const { guild } = interaction;

  switch (interaction.commandName) {
    case 'join': {
      const channel = guild.voiceStates.cache.get(interaction.user.id)?.channel;
      if (!channel) {
        await interaction.reply({ content: 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply();
      try {
        await voiceManager.join(channel, interaction.channelId);
        await interaction.editReply(
          `Joined **${channel.name}**. 🎙️ I'm listening, and I answer out loud ` +
            `${LISTEN_MODES[voiceManager.listenMode(guild.id)]} (change it with /listen). ` +
            `What I answer gets transcribed and posted here. My replies in this channel are spoken too.`,
        );
      } catch (err) {
        await interaction.editReply(`Couldn't join: ${(err as Error).message}`);
      }
      return;
    }

    case 'leave': {
      const left = voiceManager.leave(guild.id);
      await interaction.reply(left ? 'Bye!' : "I'm not in a voice channel.");
      return;
    }

    case 'say': {
      const session = voiceManager.get(guild.id);
      if (!session) {
        await interaction.reply({ content: 'Use /join first.', flags: MessageFlags.Ephemeral });
        return;
      }
      const text = interaction.options.getString('text', true);
      session.speak(text);
      await interaction.reply({ content: `Saying: ${text}`, flags: MessageFlags.Ephemeral });
      return;
    }

    case 'shutup': {
      voiceManager.get(guild.id)?.stop();
      await interaction.reply({ content: 'Okay, okay.', flags: MessageFlags.Ephemeral });
      return;
    }

    case 'listen': {
      const mode = interaction.options.getString('mode', true) as ListenMode;
      voiceManager.setListenMode(guild.id, mode);
      await interaction.reply(`Okay: in voice I'll answer ${LISTEN_MODES[mode]}.`);
      return;
    }

    case 'musings': {
      const on = interaction.options.getString('mode', true) === 'on';
      voiceManager.setMusings(guild.id, on);
      const inVoice = voiceManager.get(guild.id) !== undefined;
      await interaction.reply(
        on
          ? `Musings on. When the voice channel goes quiet, I may speak.${inVoice ? '' : ' (Once I /join one.)'}`
          : 'Musings off. I will suffer the silence like everyone else.',
      );
      return;
    }

    case 'reset': {
      history.clear(interaction.channelId);
      await interaction.reply('Memory wiped for this channel.');
      return;
    }
  }
}
