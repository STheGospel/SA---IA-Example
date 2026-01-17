require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { SlashCommandBuilder } = require('@discordjs/builders');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// --- Sensitive values should be stored in environment variables ---
// Do NOT commit real tokens, API keys, or private IDs into source control.
const TOKEN = process.env.DISCORD_BOT_TOKEN || 'YOUR_DISCORD_BOT_TOKEN';
const API_KEY = process.env.GENERATIVE_AI_API_KEY || 'YOUR_GENERATIVE_AI_API_KEY';

// Allowed channel IDs can be provided as a comma-separated env var; default empty (no channels allowed)
const ALLOWED_CHANNEL_IDS = process.env.ALLOWED_CHANNEL_IDS ? process.env.ALLOWED_CHANNEL_IDS.split(',') : [];

// Model name should come from env or a safe default placeholder
const MODEL_NAME = process.env.MODEL_NAME || 'your-model-name';

// Role names can be configured via env (avoid hardcoding organization-specific role names)
const MUTE_ROLE_NAME = process.env.MUTE_ROLE_NAME || 'Muted';
const ISOLATE_ROLE_NAME = process.env.ISOLATE_ROLE_NAME || 'Isolated';

// In-memory structures (non-persistent)
const channelHistories = {};
const userChannels = {};

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Muestra la lista de comandos disponibles'),
  new SlashCommandBuilder().setName('prompt').setDescription('Haz una pregunta al bot')
    .addStringOption(option => option.setName('input').setDescription('Pregunta').setRequired(true)),
  new SlashCommandBuilder().setName('solicitud').setDescription('Haz una solicitud específica al bot')
    .addStringOption(option => option.setName('input').setDescription('Solicitud').setRequired(true)),
  new SlashCommandBuilder().setName('ping').setDescription('Muestra el ping del bot'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Muestra información sobre el usuario')
    .addUserOption(option => option.setName('target').setDescription('El usuario objetivo').setRequired(true)),
  new SlashCommandBuilder().setName('reminder').setDescription('Configura un recordatorio')
    .addStringOption(option => option.setName('time').setDescription('Tiempo en formato 1m, 1h, 1d').setRequired(true))
    .addStringOption(option => option.setName('message').setDescription('Mensaje del recordatorio').setRequired(true)),
  new SlashCommandBuilder().setName('mute').setDescription('Mutea a un usuario')
    .addUserOption(option => option.setName('target').setDescription('El usuario a mutear').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Motivo')),
  new SlashCommandBuilder().setName('unmute').setDescription('Desmutea a un usuario')
    .addUserOption(option => option.setName('target').setDescription('El usuario a desmutear').setRequired(true)),
  new SlashCommandBuilder().setName('ban').setDescription('Banea a un usuario')
    .addUserOption(option => option.setName('target').setDescription('El usuario a banear').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Motivo')),
  new SlashCommandBuilder().setName('unban').setDescription('Desbanea a un usuario')
    .addStringOption(option => option.setName('userid').setDescription('El ID del usuario a desbanear').setRequired(true)),
  new SlashCommandBuilder().setName('aislar').setDescription('Aisla a un usuario')
    .addUserOption(option => option.setName('target').setDescription('El usuario a aislar').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Motivo')),
  new SlashCommandBuilder().setName('unaislar').setDescription('Desaisla a un usuario')
    .addUserOption(option => option.setName('target').setDescription('El usuario a desaislar').setRequired(true)),
  new SlashCommandBuilder().setName('empezar').setDescription('Inicia una conversación continua con el bot'),
  new SlashCommandBuilder().setName('salirsa').setDescription('Despliega el menú para salir de la conversación')
].map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`Bot ready.`);
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
});

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

client.commands = new Collection();

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Channel-based conversations: channels prefixed with 'conversacion-'
  if (message.channel && message.channel.name && message.channel.name.startsWith('conversacion-')) {
    if (!channelHistories[message.channel.id]) {
      channelHistories[message.channel.id] = [];
    }

    const userMessage = {
      role: 'user',
      parts: [{ text: message.content }],
    };

    channelHistories[message.channel.id].push(userMessage);

    // Use API key from environment/config — do NOT hardcode secrets
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const generationConfig = {
      temperature: 0.9,
      topK: 1,
      topP: 1,
      maxOutputTokens: 2048,
    };

    const chat = model.startChat({
      generationConfig,
      history: channelHistories[message.channel.id],
    });

    const result = await chat.sendMessage(message.content);
    let response = result.response.text();

    if (response.length > 2000) {
      response = response.substring(0, 1997) + '...';
    }

    const botMessage = {
      role: 'model',
      parts: [{ text: response }],
    };

    channelHistories[message.channel.id].push(botMessage);

    await message.reply(response);
  }

  // Example: react to a keyword only in allowed channels (configured via env)
  if (message.channel && ALLOWED_CHANNEL_IDS.includes(message.channel.id)) {
    if (message.content.toLowerCase() === 'ayuda') {
      const embed1 = new EmbedBuilder()
        .setColor('#000000')
        .setTitle('Comandos S.A')
        .addFields(
          { name: 'Comando', value: '/help', inline: false },
          { name: 'Descripción', value: 'Muestra la lista de comandos disponibles', inline: false },
          { name: 'Comando', value: '/prompt', inline: false },
          { name: 'Descripción', value: 'Haz una pregunta al bot', inline: false },
          { name: 'Comando', value: '/solicitud', inline: false },
          { name: 'Descripción', value: 'Haz una solicitud específica al bot', inline: false },
          { name: 'Comando', value: '/ping', inline: false },
          { name: 'Descripción', value: 'Muestra el ping del bot', inline: false },
          { name: 'Comando', value: '/userinfo', inline: false },
          { name: 'Descripción', value: 'Muestra información sobre el usuario', inline: false },
          { name: 'Comando', value: '/reminder', inline: false },
          { name: 'Descripción', value: 'Configura un recordatorio', inline: false },
          { name: 'Comando', value: '/mute', inline: false },
          { name: 'Descripción', value: 'Mutea a un usuario', inline: false },
          { name: 'Comando', value: '/unmute', inline: false },
          { name: 'Descripción', value: 'Desmutea a un usuario', inline: false },
          { name: 'Comando', value: '/ban', inline: false },
          { name: 'Descripción', value: 'Banea a un usuario', inline: false },
          { name: 'Comando', value: '/unban', inline: false },
          { name: 'Descripción', value: 'Desbanea a un usuario', inline: false },
        )
        .setTimestamp();

      const embed2 = new EmbedBuilder()
        .setColor('#000000')
        .setTitle('Comandos S.A - Parte 2')
        .addFields(
          { name: 'Comando', value: '/aislar', inline: false },
          { name: 'Descripción', value: 'Aisla a un usuario', inline: false },
          { name: 'Comando', value: '/unaislar', inline: false },
          { name: 'Descripción', value: 'Desaisla a un usuario', inline: false },
          { name: 'Comando', value: '/empezar', inline: false },
          { name: 'Descripción', value: 'Inicia una conversación continua con el bot', inline: false },
        )
        .setTimestamp();

      await message.reply({ embeds: [embed1, embed2] });
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isButton()) return;

  if (interaction.isCommand()) {
    const { commandName } = interaction;

    if (commandName === 'help') {
      const embed1 = new EmbedBuilder()
        .setColor('#000000')
        .setTitle('Comandos S.A')
        .addFields(
          { name: 'Comando', value: '/help', inline: false },
          { name: 'Descripción', value: 'Muestra la lista de comandos disponibles', inline: false },
          { name: 'Comando', value: '/prompt', inline: false },
          { name: 'Descripción', value: 'Haz una pregunta al bot', inline: false },
          { name: 'Comando', value: '/solicitud', inline: false },
          { name: 'Descripción', value: 'Haz una solicitud específica al bot', inline: false },
          { name: 'Comando', value: '/ping', inline: false },
          { name: 'Descripción', value: 'Muestra el ping del bot', inline: false },
          { name: 'Comando', value: '/userinfo', inline: false },
          { name: 'Descripción', value: 'Muestra información sobre el usuario', inline: false },
          { name: 'Comando', value: '/reminder', inline: false },
          { name: 'Descripción', value: 'Configura un recordatorio', inline: false },
          { name: 'Comando', value: '/mute', inline: false },
          { name: 'Descripción', value: 'Mutea a un usuario', inline: false },
          { name: 'Comando', value: '/unmute', inline: false },
          { name: 'Descripción', value: 'Desmutea a un usuario', inline: false },
          { name: 'Comando', value: '/ban', inline: false },
          { name: 'Descripción', value: 'Banea a un usuario', inline: false },
          { name: 'Comando', value: '/unban', inline: false },
          { name: 'Descripción', value: 'Desbanea a un usuario', inline: false },
        )
        .setTimestamp();

      const embed2 = new EmbedBuilder()
        .setColor('#000000')
        .setTitle('| Comandos S.A ')
        .addFields(
          { name: 'Comando', value: '/aislar', inline: false },
          { name: 'Descripción', value: 'Aisla a un usuario', inline: false },
          { name: 'Comando', value: '/unaislar', inline: false },
          { name: 'Descripción', value: 'Desaisla a un usuario', inline: false },
          { name: 'Comando', value: '/empezar', inline: false },
          { name: 'Descripción', value: 'Inicia una conversación continua con el bot', inline: false },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed1, embed2] });
    } else if (commandName === 'empezar') {
      const user = interaction.user;

      if (userChannels[user.id]) {
        await interaction.reply({ content: 'Ya tienes una conversación abierta. No puedes crear más de una.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor('#000000')
        .setTitle('Abrir Conversación con S.A 🤖')
        .setDescription('Para iniciar una conversación con S.A, haz clic en el botón de abajo.')
        .setImage('attachment://ai.gif');

      const button = new ButtonBuilder()
        .setCustomId('start_conversation')
        .setLabel('Crear Conversación 💭')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      await interaction.reply({ embeds: [embed], components: [row], files: [{ attachment: path.join(__dirname, 'ai.gif'), name: 'ai.gif' }] });
    } else if (commandName === 'prompt' || commandName === 'solicitud') {
      const input = interaction.options.getString('input');
      await handleGenerativeResponse(interaction, input);
    } else if (commandName === 'ping') {
      await interaction.reply(`Pong! Latencia: ${Date.now() - interaction.createdTimestamp}ms`);
    } else if (commandName === 'userinfo') {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply('No tienes permisos para usar este comando.');
        return;
      }
      const user = interaction.options.getUser('target');
      const member = interaction.guild.members.cache.get(user.id);

      const embed = new EmbedBuilder()
        .setColor('#000000')
        .setTitle('Información del Usuario')
        .addFields(
          { name: 'ID', value: user.id, inline: true },
          { name: 'Apodo', value: member ? member.nickname || 'Ninguno' : 'N/A', inline: true },
          { name: 'Fecha de ingreso', value: member ? new Date(member.joinedTimestamp).toLocaleDateString() : 'N/A', inline: false },
        )
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } else if (commandName === 'reminder') {
      const time = interaction.options.getString('time');
      const message = interaction.options.getString('message');

      const timeInMs = parseTimeString(time);
      if (timeInMs === null) {
        await interaction.reply('Formato de tiempo no válido. Usa m para minutos, h para horas, d para días.');
        return;
      }

      setTimeout(() => {
        interaction.followUp(`Recordatorio: ${message}`);
      }, timeInMs);

      await interaction.reply(`Recordatorio configurado para ${time} desde ahora.`);
    } else if (commandName === 'mute') {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply('No tienes permisos para usar este comando.');
        return;
      }
      const user = interaction.options.getUser('target');
      const reason = interaction.options.getString('reason') || 'No se especificó motivo';
      const member = interaction.guild.members.cache.get(user.id);

      const muteRole = interaction.guild.roles.cache.find(role => role.name === MUTE_ROLE_NAME);
      if (!muteRole) {
        await interaction.reply(`No se encontró el rol "${MUTE_ROLE_NAME}".`);
        return;
      }

      member.roles.add(muteRole);
      await interaction.reply(`${user.tag} ha sido muteado. Motivo: ${reason}`);
    } else if (commandName === 'unmute') {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply('No tienes permisos para usar este comando.');
        return;
      }
      const user = interaction.options.getUser('target');
      const member = interaction.guild.members.cache.get(user.id);

      const muteRole = interaction.guild.roles.cache.find(role => role.name === MUTE_ROLE_NAME);
      if (!muteRole) {
        await interaction.reply(`No se encontró el rol "${MUTE_ROLE_NAME}".`);
        return;
      }

      member.roles.remove(muteRole);
      await interaction.reply(`${user.tag} ha sido desmuteado.`);
    } else if (commandName === 'ban') {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply('No tienes permisos para usar este comando.');
        return;
      }
      const user = interaction.options.getUser('target');
      const reason = interaction.options.getString('reason') || 'No se especificó motivo';
      const member = interaction.guild.members.cache.get(user.id);

      await member.ban({ reason });
      await interaction.reply(`${user.tag} ha sido baneado. Motivo: ${reason}`);
    } else if (commandName === 'unban') {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply('No tienes permisos para usar este comando.');
        return;
      }
      const userId = interaction.options.getString('userid');

      try {
        await interaction.guild.members.unban(userId);
        await interaction.reply(`El usuario con ID ${userId} ha sido desbaneado.`);
      } catch (error) {
        console.error(error);
        await interaction.reply('Hubo un error al intentar desbanear al usuario. Asegúrate de que la ID es correcta.');
      }
    } else if (commandName === 'aislar') {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply('No tienes permisos para usar este comando.');
        return;
      }
      const user = interaction.options.getUser('target');
      const reason = interaction.options.getString('reason') || 'No se especificó motivo';
      const member = interaction.guild.members.cache.get(user.id);

      const isolateRole = interaction.guild.roles.cache.find(role => role.name === ISOLATE_ROLE_NAME);
      if (!isolateRole) {
        await interaction.reply(`No se encontró el rol "${ISOLATE_ROLE_NAME}".`);
        return;
      }

      member.roles.add(isolateRole);
      await interaction.reply(`${user.tag} ha sido aislado. Motivo: ${reason}`);
    } else if (commandName === 'unaislar') {
      if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply('No tienes permisos para usar este comando.');
        return;
      }
      const user = interaction.options.getUser('target');
      const member = interaction.guild.members.cache.get(user.id);

      const isolateRole = interaction.guild.roles.cache.find(role => role.name === ISOLATE_ROLE_NAME);
      if (!isolateRole) {
        await interaction.reply(`No se encontró el rol "${ISOLATE_ROLE_NAME}".`);
        return;
      }

      member.roles.remove(isolateRole);
      await interaction.reply(`${user.tag} ha sido desaislado.`);
    } else if (commandName === 'salirsa') {
      const channel = interaction.channel;
      const user = interaction.user;

      if (!channel.name || !channel.name.startsWith('conversacion-')) {
        await interaction.reply({ content: 'No puedes desplegar el menú de salida de conversación en este canal.', ephemeral: true });
        return;
      }

      const closeButton = new ButtonBuilder()
        .setCustomId('close_conversation')
        .setLabel('Salir de la conversación ❌')
        .setStyle(ButtonStyle.Danger);

      const closeRow = new ActionRowBuilder().addComponents(closeButton);

      const embed = new EmbedBuilder()
        .setColor('#000000')
        .setTitle('S.A 🤖')
        .setDescription('Para salir de la conversación con S.A, haz clic en el botón de abajo.')
        .setImage('attachment://ai.gif');

      await interaction.reply({
        embeds: [embed],
        components: [closeRow],
        files: [{ attachment: path.join(__dirname, 'ai.gif'), name: 'ai.gif' }],
        ephemeral: true
      });
    }
  } else if (interaction.isButton()) {
    if (interaction.customId === 'start_conversation') {
      const user = interaction.user;
      const guild = interaction.guild;

      if (userChannels[user.id]) {
        await interaction.reply({ content: 'Ya tienes una conversación abierta. No puedes crear más de una.', ephemeral: true });
        return;
      }

      try {
        const channel = await guild.channels.create({
          name: `conversacion-${user.username}`,
          type: 0,
          permissionOverwrites: [
            {
              id: guild.roles.everyone,
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
              id: user.id,
              allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
            },
            {
              id: client.user.id,
              allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
            },
          ],
        });

        channelHistories[channel.id] = [];
        userChannels[user.id] = channel.id;

        const closeButton = new ButtonBuilder()
          .setCustomId('close_conversation')
          .setLabel('Salir de la conversación ❌')
          .setStyle(ButtonStyle.Danger);

        const closeRow = new ActionRowBuilder().addComponents(closeButton);

        const embed = new EmbedBuilder()
          .setColor('#000000')
          .setTitle('S.A 🤖')
          .setDescription('Para salir de la conversación con S.A, haz clic en el botón de abajo.')
          .setImage('attachment://ai.gif');

        await channel.send({
          embeds: [embed],
          components: [closeRow],
          files: [{ attachment: path.join(__dirname, 'ai.gif'), name: 'ai.gif' }]
        });

        await interaction.reply({ content: `He creado un canal para ti: ${channel}`, ephemeral: true });
      } catch (error) {
        console.error('Error creating channel:', error);
        await interaction.reply({ content: 'Hubo un error al crear el canal.', ephemeral: true });
      }
    } else if (interaction.customId === 'close_conversation') {
      const user = interaction.user;
      const channel = interaction.channel;

      if (userChannels[user.id] !== channel.id) {
        await interaction.reply({ content: 'No puedes cerrar este canal.', ephemeral: true });
        return;
      }

      const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_close_conversation')
        .setLabel('Sí')
        .setStyle(ButtonStyle.Danger);

      const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_close_conversation')
        .setLabel('No')
        .setStyle(ButtonStyle.Secondary);

      const confirmRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

      await interaction.reply({
        content: '¿Estás seguro de que quieres salir de la conversación?',
        components: [confirmRow],
        ephemeral: true
      });
    } else if (interaction.customId === 'confirm_close_conversation') {
      const user = interaction.user;
      const channel = interaction.channel;

      if (userChannels[user.id] !== channel.id) {
        await interaction.reply({ content: 'No puedes cerrar este canal.', ephemeral: true });
        return;
      }

      try {
        delete channelHistories[channel.id];
        delete userChannels[user.id];

        await channel.delete('Conversación finalizada por el usuario.');
      } catch (error) {
        console.error('Error deleting channel:', error);
        await interaction.reply({ content: 'Hubo un error al eliminar el canal.', ephemeral: true });
      }
    } else if (interaction.customId === 'cancel_close_conversation') {
      await interaction.update({ content: 'La conversación no se ha cerrado.', components: [], ephemeral: true });
    }
  }
});

async function handleGenerativeResponse(interaction, input) {
  await interaction.deferReply();

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
  };

  const chat = model.startChat({
    generationConfig,
  });

  const result = await chat.sendMessage(input);
  let response = result.response.text();

  if (response.length > 2000) {
    response = response.substring(0, 1997) + '...';
  }

  await interaction.editReply(response);
}

function parseTimeString(time) {
  const match = time.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

client.on('error', error => {
  console.error('Unhandled client error:', error);
});

// Start login using token from environment — do NOT store tokens in source control.
client.login(TOKEN);
