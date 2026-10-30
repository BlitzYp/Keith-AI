import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { handleMessage } from './chat.js';
import { handleCommand, registerCommands } from './commands.js';
import { voiceManager } from './voice/manager.js';

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
  try {
    await registerCommands();
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(client, message).catch((err) => console.error('[message]', err));
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  handleCommand(interaction).catch((err) => console.error('[command]', err));
});

function shutdown() {
  console.log('Shutting down...');
  voiceManager.leaveAll();
  void client.destroy().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(config.discord.token);
