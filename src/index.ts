import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleDiscordMessage, handleSpokenMessage } from './chat/discordMessages.js';
import { HistoryStore } from './chat/history.js';
import { createResponder } from './chat/respond.js';
import { handleCommand, registerCommands } from './commands.js';
import { config } from './config.js';
import { PromptFile } from './personality/promptFile.js';
import { streamReply } from './llm/client.js';
import { voiceManager } from './voice/manager.js';

// The pieces are put together here, so each one can be tested on its own.
const history = new HistoryStore(config.bot.historyMaxMessages);

// SYSTEM_PROMPT in .env wins; otherwise the Markdown file, re-read for every reply.
const promptFile = config.bot.systemPromptText
  ? null
  : new PromptFile(config.bot.systemPromptFile, config.bot.name);

const respond = createResponder({
  systemPrompt: config.bot.systemPromptText ?? (() => promptFile!.get()),
  history,
  streamReply,
  // Replies are spoken only in the text channel /join was used in.
  speechFor: ({ guildId, channelId }) => {
    const session = voiceManager.get(guildId);
    return session?.textChannelId === channelId ? session.startReply() : undefined;
  },
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: enable it in the Developer Portal
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(`LLM: ${config.llm.model} @ ${config.llm.baseURL}`);
  console.log(`Personality: ${promptFile ? config.bot.systemPromptFile : 'SYSTEM_PROMPT in .env'}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on(Events.MessageCreate, (message) => {
  handleDiscordMessage(message, respond, config.llm.seesImages).catch((err) => console.error('[message]', err));
});

// Whatever someone says in Keith's voice channel gets answered like a chat message.
voiceManager.onHeard((spoken) => {
  handleSpokenMessage(client, spoken, respond).catch((err) => console.error('[voice message]', err));
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  handleCommand(interaction, history).catch((err) => console.error('[command]', err));
});

function shutdown() {
  console.log('Shutting down...');
  voiceManager.leaveAll();
  void client.destroy().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(config.discord.token);
